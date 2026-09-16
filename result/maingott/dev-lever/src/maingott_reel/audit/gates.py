"""The quality gates.

A Reel is complete only when the resolution is right, the duration is in
bounds, the streams exist, the captions sit inside the safe areas, the logo is
readable, no placeholder text remains, no unsupported business claim appears,
every generated asset is tracked, and FFmpeg agrees the file is what it says
it is. Each of those is a gate here.

The gates re-derive their answers from the artifacts rather than trusting what
an earlier stage recorded: a run that drifted between stages must fail even if
every stage passed at the time.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from maingott_reel.assets.probe import MediaInfo, MediaProbe, ProbeError
from maingott_reel.audio.probe import AudioProbe
from maingott_reel.creative.claims import PLACEHOLDER_PATTERNS as CLAIM_PLACEHOLDERS
from maingott_reel.creative.claims import ClaimPolicy, validate_plan
from maingott_reel.models import (
    AssetCollection,
    Composition,
    CreativeBrief,
    FactRegistry,
    GateGroup,
    GateSeverity,
    QualityGate,
    RunManifest,
    ScriptPlan,
    StageName,
    Storyboard,
    VoiceAsset,
)
from maingott_reel.utils.hashing import sha256_file, sha256_text

#: Codecs an Instagram Reel upload is expected to carry.
EXPECTED_VIDEO_CODECS = ("h264", "avc1")
EXPECTED_AUDIO_CODECS = ("aac",)

#: How far the finished file may drift from the storyboard's timeline.
DURATION_TOLERANCE_SECONDS = 0.25

#: How far the measured frame rate may drift from the configured one.
FRAME_RATE_TOLERANCE = 0.5

#: Ink may sit this many pixels outside the safe area before it counts as a
#: violation: text shadows extend slightly past the glyphs themselves.
SAFE_AREA_TOLERANCE_PIXELS = 12

#: A brand mark narrower than this fraction of the frame is not readable.
MIN_LOGO_WIDTH_RATIO = 0.15

#: Stages a finished run must have recorded.
REQUIRED_STAGES = (
    StageName.ANALYZE,
    StageName.PLAN,
    StageName.STORYBOARD,
    StageName.GENERATE_ASSETS,
    StageName.COMPOSE,
)

#: How far the narration may overrun the timeline before the mix would cut it.
VOICE_TIMELINE_TOLERANCE_SECONDS = 0.25

#: Artifacts the manifest must point at.
REQUIRED_FILES = (
    "source",
    "facts",
    "creative_brief",
    "script",
    "storyboard",
    "assets",
    "composition",
    "final",
)


def _gate(
    name: str,
    group: GateGroup,
    passed: bool,
    detail: str | None = None,
    severity: GateSeverity = GateSeverity.ERROR,
) -> QualityGate:
    return QualityGate(name=name, group=group, passed=passed, detail=detail, severity=severity)


# --- the run held together -------------------------------------------------


def run_gates(
    manifest: RunManifest,
    registry: FactRegistry,
    plan: ScriptPlan,
    storyboard: Storyboard,
    assets: AssetCollection,
    composition: Composition,
    storyboard_path: Path,
    source_path: Path | None,
) -> list[QualityGate]:
    """Check that the artifacts exist, agree, and have not drifted apart."""
    missing_stages = [
        stage.value for stage in REQUIRED_STAGES if not manifest.stage_completed(stage)
    ]
    missing_files = [name for name in REQUIRED_FILES if name not in manifest.files]

    sources = {
        "facts": registry.source_sha256,
        "plan": plan.provenance.source_sha256,
        "storyboard": storyboard.provenance.source_sha256,
        "assets": assets.source_sha256,
        "composition": composition.source_sha256,
    }
    narrations = {
        "plan": sha256_text(plan.narration),
        "storyboard": storyboard.narration_sha256,
        "assets": assets.narration_sha256,
        "composition": composition.narration_sha256,
    }
    storyboard_hash = sha256_file(storyboard_path)

    gates = [
        _gate(
            "every_stage_completed",
            GateGroup.RUN,
            not missing_stages,
            f"missing: {', '.join(missing_stages)}" if missing_stages else "analyze → compose",
        ),
        _gate(
            "artifacts_tracked_in_manifest",
            GateGroup.RUN,
            not missing_files,
            f"missing: {', '.join(missing_files)}"
            if missing_files
            else f"{len(REQUIRED_FILES)} artifacts",
        ),
        _gate(
            "one_source_specification",
            GateGroup.RUN,
            len(set(sources.values())) == 1,
            _disagreement(sources) or f"sha256 {registry.source_sha256[:12]}",
        ),
        _gate(
            "one_approved_narration",
            GateGroup.RUN,
            len(set(narrations.values())) == 1,
            _disagreement(narrations) or f"sha256 {narrations['plan'][:12]}",
        ),
        _gate(
            "assets_match_the_storyboard",
            GateGroup.RUN,
            assets.storyboard_sha256 == storyboard_hash,
            "the storyboard changed after the assets were generated"
            if assets.storyboard_sha256 != storyboard_hash
            else f"sha256 {storyboard_hash[:12]}",
        ),
        _gate(
            "composition_matches_the_storyboard",
            GateGroup.RUN,
            composition.storyboard_sha256 == storyboard_hash,
            "the storyboard changed after the Reel was composed"
            if composition.storyboard_sha256 != storyboard_hash
            else None,
        ),
    ]

    if source_path is not None and source_path.is_file():
        current = sha256_file(source_path)
        gates.append(
            _gate(
                "source_document_unchanged",
                GateGroup.RUN,
                current == registry.source_sha256,
                f"{source_path.name} changed since the analysis"
                if current != registry.source_sha256
                else source_path.name,
            )
        )
    return gates


def _disagreement(hashes: dict[str, str]) -> str | None:
    """Describe which artifacts disagree, if any do."""
    if len(set(hashes.values())) == 1:
        return None
    return ", ".join(f"{name}={value[:8]}" for name, value in hashes.items())


def asset_gates(assets: AssetCollection, storyboard: Storyboard) -> list[QualityGate]:
    """Check that every scene's footage is tracked and still intact."""
    missing_scenes = [scene.id for scene in storyboard.scenes if assets.for_scene(scene.id) is None]
    unusable = [asset.scene_id for asset in assets.assets if not asset.is_usable]

    absent: list[str] = []
    changed: list[str] = []
    for asset in assets.assets:
        if asset.path is None or not asset.path.is_file():
            absent.append(asset.id)
            continue
        if asset.sha256 and sha256_file(asset.path) != asset.sha256:
            changed.append(asset.id)

    return [
        _gate(
            "every_scene_has_an_asset",
            GateGroup.RUN,
            not missing_scenes,
            f"missing: {', '.join(missing_scenes)}"
            if missing_scenes
            else f"{len(assets.assets)} assets",
        ),
        _gate(
            "every_asset_is_usable",
            GateGroup.RUN,
            not unusable,
            f"unusable: {', '.join(str(scene) for scene in unusable)}" if unusable else None,
        ),
        _gate(
            "asset_files_are_present",
            GateGroup.RUN,
            not absent,
            f"missing files: {', '.join(absent)}" if absent else None,
        ),
        _gate(
            "asset_files_are_unchanged",
            GateGroup.RUN,
            not changed,
            f"hash mismatch: {', '.join(changed)}" if changed else "sha256 verified",
        ),
    ]


# --- what the Reel says ------------------------------------------------------


def claim_gates(
    plan: ScriptPlan,
    brief: CreativeBrief,
    storyboard: Storyboard,
    composition: Composition,
    registry: FactRegistry,
    min_duration: int,
    max_duration: int,
) -> list[QualityGate]:
    """Re-run the claims policy against the facts, and check nothing drifted."""
    policy = ClaimPolicy(
        target_duration_seconds=plan.target_duration_seconds,
        min_duration_seconds=min_duration,
        max_duration_seconds=max_duration,
        language=plan.language,
        allow_target_facts=plan.provenance.target_facts_allowed,
        offered_fact_ids=frozenset(plan.provenance.offered_fact_ids),
    )
    report = validate_plan(plan.beats, brief, registry, policy)
    gates = [
        _gate(
            f"claims::{check.name}",
            GateGroup.CLAIMS,
            check.passed,
            check.detail,
        )
        for check in report.checks
    ]

    approved = {scene.id: scene.overlay_text.strip() for scene in storyboard.scenes}
    rewritten = [
        cue.id for cue in composition.captions if cue.text != approved.get(cue.scene_id, "")
    ]
    spoken = {scene.id: scene.voiceover for scene in storyboard.scenes}
    narration = {beat.id: beat.narration for beat in plan.beats}
    drifted = [
        scene.id
        for scene in storyboard.scenes
        if spoken[scene.id] != narration.get(scene.beat_id, "")
    ]
    unsourced = [
        scene.id
        for scene in storyboard.scenes
        if scene.source_fact_ids and registry.unknown_ids(scene.source_fact_ids)
    ]

    gates.extend(
        [
            _gate(
                "captions_are_the_approved_wording",
                GateGroup.CLAIMS,
                not rewritten,
                f"rewritten: {', '.join(rewritten)}"
                if rewritten
                else f"{len(composition.captions)} captions",
            ),
            _gate(
                "narration_is_the_approved_wording",
                GateGroup.CLAIMS,
                not drifted,
                f"rewritten in: {', '.join(drifted)}" if drifted else None,
            ),
            _gate(
                "every_cited_fact_exists",
                GateGroup.CLAIMS,
                not unsourced,
                f"unknown facts cited by: {', '.join(unsourced)}" if unsourced else None,
            ),
        ]
    )
    return gates


def placeholder_gate(
    brief: CreativeBrief, storyboard: Storyboard, composition: Composition
) -> QualityGate:
    """No leftover scaffolding may reach the viewer."""
    texts = [
        *(cue.text for cue in composition.captions),
        *(scene.overlay_text for scene in storyboard.scenes),
        *(scene.voiceover for scene in storyboard.scenes),
        brief.core_message,
        brief.cta,
    ]
    found = sorted(
        {
            match.group(0)
            for text in texts
            for pattern in CLAIM_PLACEHOLDERS
            for match in pattern.finditer(text)
        }
    )
    return _gate(
        "no_placeholder_text",
        GateGroup.CLAIMS,
        not found,
        ", ".join(found) if found else "captions, overlays and narration are clean",
    )


# --- the file itself ----------------------------------------------------------


def file_gates(
    path: Path,
    composition: Composition,
    probe: MediaProbe,
    min_duration: int,
    max_duration: int,
) -> list[QualityGate]:
    """Read the finished file back and check it is what it claims to be."""
    if not path.is_file():
        return [_gate("final_file_exists", GateGroup.FILE, False, f"{path} does not exist")]

    gates = [_gate("final_file_exists", GateGroup.FILE, True, str(path))]
    size = path.stat().st_size
    gates.append(_gate("final_file_is_not_empty", GateGroup.FILE, size > 1024, f"{size} bytes"))

    if composition.output_sha256:
        digest = sha256_file(path)
        gates.append(
            _gate(
                "final_file_is_unchanged",
                GateGroup.FILE,
                digest == composition.output_sha256,
                "the file changed after it was composed"
                if digest != composition.output_sha256
                else f"sha256 {digest[:12]}",
            )
        )

    try:
        info = probe.inspect(path)
    except ProbeError as error:
        gates.append(_gate("media_is_readable", GateGroup.FILE, False, str(error)))
        return gates
    gates.append(_gate("media_is_readable", GateGroup.FILE, True, f"inspected with {info.tool}"))
    gates.extend(_media_gates(info, composition, min_duration, max_duration))
    return gates


def _media_gates(
    info: MediaInfo, composition: Composition, min_duration: int, max_duration: int
) -> list[QualityGate]:
    """The technical gates, given what the probe reported."""
    settings = composition.settings
    drift = abs(info.duration_seconds - composition.timeline_duration_seconds)
    in_bounds = min_duration <= info.duration_seconds <= max_duration
    rate_ok = info.frame_rate is None or abs(info.frame_rate - settings.fps) <= FRAME_RATE_TOLERANCE

    return [
        _gate(
            "resolution_is_correct",
            GateGroup.FILE,
            (info.width, info.height) == (settings.width, settings.height),
            f"{info.width}x{info.height}, expected {settings.width}x{settings.height}",
        ),
        _gate(
            "aspect_ratio_is_portrait",
            GateGroup.FILE,
            info.height > info.width,
            f"{info.width}x{info.height}",
        ),
        _gate(
            "duration_is_within_bounds",
            GateGroup.FILE,
            in_bounds,
            f"{info.duration_seconds}s, allowed {min_duration}-{max_duration}s",
        ),
        _gate(
            "duration_matches_the_storyboard",
            GateGroup.FILE,
            drift <= DURATION_TOLERANCE_SECONDS,
            f"{info.duration_seconds}s against a {composition.timeline_duration_seconds}s timeline",
        ),
        _gate(
            "frame_rate_is_correct",
            GateGroup.FILE,
            rate_ok,
            f"{info.frame_rate} fps, expected {settings.fps}",
        ),
        _gate(
            "video_stream_exists",
            GateGroup.FILE,
            info.has_video_stream and info.video_streams == 1,
            f"{info.video_streams} video streams",
        ),
        _gate(
            "audio_stream_exists",
            GateGroup.FILE,
            info.has_audio_stream and info.audio_streams == 1,
            f"{info.audio_streams} audio streams",
        ),
        _gate(
            "no_unexpected_streams",
            GateGroup.FILE,
            info.other_streams == 0,
            f"{info.other_streams} extra streams",
            severity=GateSeverity.WARNING,
        ),
        _gate(
            "video_codec_is_supported",
            GateGroup.FILE,
            info.codec.lower() in EXPECTED_VIDEO_CODECS,
            info.codec or "unknown",
        ),
        _gate(
            "audio_codec_is_supported",
            GateGroup.FILE,
            composition.settings.audio_codec.lower() in EXPECTED_AUDIO_CODECS,
            composition.settings.audio_codec,
        ),
    ]


# --- how it looks --------------------------------------------------------------


def presentation_gates(composition: Composition) -> list[QualityGate]:
    """Check the captions sit inside the safe area and the logo is readable."""
    settings = composition.settings
    left, top, right, bottom = settings.safe_area.box(settings.width, settings.height)
    tolerance = SAFE_AREA_TOLERANCE_PIXELS

    unmeasurable: list[str] = []
    outside: list[str] = []
    for cue in composition.captions:
        if cue.image_path is None or not cue.image_path.is_file():
            unmeasurable.append(cue.id)
            continue
        box = _ink_box(cue.image_path)
        if box is None:
            unmeasurable.append(cue.id)
            continue
        ink_left, ink_top, ink_right, ink_bottom = box
        if (
            ink_left < left - tolerance
            or ink_top < top - tolerance
            or ink_right > right + tolerance
            or ink_bottom > bottom + tolerance
        ):
            outside.append(f"{cue.id} at ({ink_left},{ink_top})-({ink_right},{ink_bottom})")

    gates = [
        _gate(
            "captions_are_inside_the_safe_area",
            GateGroup.PRESENTATION,
            not outside,
            "; ".join(outside) if outside else f"safe area ({left},{top})-({right},{bottom})",
        ),
        _gate(
            "every_caption_was_rendered",
            GateGroup.PRESENTATION,
            not unmeasurable,
            f"not measurable: {', '.join(unmeasurable)}" if unmeasurable else None,
        ),
        _gate(
            "every_scene_is_on_the_timeline",
            GateGroup.PRESENTATION,
            len(composition.scenes) > 0
            and [scene.order for scene in composition.scenes]
            == list(range(1, len(composition.scenes) + 1)),
            f"{len(composition.scenes)} scenes in order",
        ),
    ]
    gates.extend(_logo_gates(composition))
    return gates


def _ink_box(path: Path) -> tuple[int, int, int, int] | None:
    """Return the bounding box of the drawn pixels in a caption image."""
    with Image.open(path) as image:
        return image.convert("RGBA").getchannel("A").getbbox()


def _logo_gates(composition: Composition) -> list[QualityGate]:
    """The brand mark has to be present, on canvas and big enough to read."""
    logo = composition.logo
    if logo is None:
        return [
            _gate(
                "approved_logo_is_applied",
                GateGroup.PRESENTATION,
                False,
                "no logo was applied",
                severity=GateSeverity.WARNING,
            )
        ]

    settings = composition.settings
    ratio = logo.render_width / settings.width
    height = round(logo.height * logo.render_width / logo.width)
    on_canvas = (
        logo.position_x >= 0
        and logo.position_y >= 0
        and logo.position_x + logo.render_width <= settings.width
        and logo.position_y + height <= settings.height
    )
    return [
        _gate("approved_logo_is_applied", GateGroup.PRESENTATION, True, str(logo.path)),
        _gate(
            "logo_file_is_present",
            GateGroup.PRESENTATION,
            logo.path.is_file(),
            str(logo.path),
        ),
        _gate(
            "logo_is_readable",
            GateGroup.PRESENTATION,
            ratio >= MIN_LOGO_WIDTH_RATIO,
            f"{round(ratio * 100)}% of the frame width, minimum "
            f"{round(MIN_LOGO_WIDTH_RATIO * 100)}%",
        ),
        _gate(
            "logo_is_fully_on_screen",
            GateGroup.PRESENTATION,
            on_canvas,
            f"placed at ({logo.position_x},{logo.position_y}) at {logo.render_width}x{height}",
        ),
        _gate(
            "logo_has_transparency",
            GateGroup.PRESENTATION,
            logo.has_alpha,
            "the brand mark has no alpha channel and will sit on a box"
            if not logo.has_alpha
            else None,
            severity=GateSeverity.WARNING,
        ),
    ]


# --- ready to publish ------------------------------------------------------------


def readiness_gates(composition: Composition) -> list[QualityGate]:
    """What still separates this Reel from a publishable one."""
    return [
        _gate(
            "narration_is_present",
            GateGroup.READINESS,
            not composition.audio.silent,
            "silent development audio" if composition.audio.silent else "narration mixed in",
            severity=GateSeverity.WARNING,
        ),
        _gate(
            "brand_mark_is_present",
            GateGroup.READINESS,
            composition.logo is not None,
            "composed without a logo" if composition.logo is None else str(composition.logo.path),
            severity=GateSeverity.WARNING,
        ),
        _gate(
            "narration_is_a_production_voice",
            GateGroup.READINESS,
            not composition.audio.voice_is_development,
            "the narration is a development placeholder, not a voice"
            if composition.audio.voice_is_development
            else "generated by a speech model",
            severity=GateSeverity.WARNING,
        ),
        _gate(
            "not_a_development_output",
            GateGroup.READINESS,
            not composition.development,
            "this Reel was composed in development mode and must not be published"
            if composition.development
            else "production output",
            severity=GateSeverity.WARNING,
        ),
    ]


# --- what is actually spoken --------------------------------------------------


def voice_gates(
    composition: Composition,
    storyboard: Storyboard,
    plan: ScriptPlan,
    manifest: RunManifest,
    voice: VoiceAsset | None,
    probe: AudioProbe | None = None,
) -> list[QualityGate]:
    """Check the narration in the Reel is the approved script, spoken.

    A silent development Reel is reported as such and nothing more: the
    readiness gates already say it must not be published. A Reel that *does*
    carry narration has to prove where those words came from.
    """
    audio = composition.audio
    if audio.silent or audio.voice_path is None:
        return [
            _gate(
                "narration_was_generated",
                GateGroup.VOICE,
                False,
                "this Reel was composed without narration",
                severity=GateSeverity.WARNING,
            )
        ]

    if voice is None:
        # An approved track supplied from outside the pipeline. The file is
        # still checked, but there is no generation record to audit it
        # against, and the report says so rather than implying there is one.
        return [
            _gate(
                "narration_was_generated",
                GateGroup.VOICE,
                True,
                f"{audio.voice_path} — supplied from outside the pipeline, so its wording "
                "is an approval decision, not a checkable one",
            ),
            *_voice_file_gates(audio.voice_path, audio.voice_sha256, None, probe),
        ]

    gates = [
        _gate("narration_was_generated", GateGroup.VOICE, True, str(audio.voice_path)),
        _gate("narration_provenance_is_recorded", GateGroup.VOICE, True, voice.id),
    ]
    approved = sha256_text(plan.narration)
    gates.extend(
        [
            _gate(
                "voice_is_tracked_in_the_manifest",
                GateGroup.VOICE,
                "voice" in manifest.files and manifest.stage_completed(StageName.GENERATE_VOICE),
                "voice.json is not recorded as a completed stage"
                if "voice" not in manifest.files
                or not manifest.stage_completed(StageName.GENERATE_VOICE)
                else str(manifest.files["voice"]),
            ),
            _gate(
                "voice_speaks_the_approved_narration",
                GateGroup.VOICE,
                voice.narration_sha256 == approved == storyboard.narration_sha256,
                f"sha256 {voice.narration_sha256[:12]}"
                if voice.narration_sha256 == approved == storyboard.narration_sha256
                else f"voice={voice.narration_sha256[:8]}, plan={approved[:8]}, "
                f"storyboard={storyboard.narration_sha256[:8]}",
            ),
            _gate(
                "the_reel_mixed_that_narration",
                GateGroup.VOICE,
                audio.voice_narration_sha256 == voice.narration_sha256
                and audio.voice_asset_id == voice.id,
                "the Reel was composed from a different narration track"
                if audio.voice_narration_sha256 != voice.narration_sha256
                or audio.voice_asset_id != voice.id
                else f"{voice.id} ({voice.provider}:{voice.model}, voice '{voice.voice}')",
            ),
            _gate(
                "voice_provenance_matches_the_run",
                GateGroup.VOICE,
                voice.provenance.source_sha256 == composition.source_sha256
                and voice.storyboard_sha256 == composition.storyboard_sha256,
                "the narration was generated from a different source or storyboard"
                if voice.provenance.source_sha256 != composition.source_sha256
                or voice.storyboard_sha256 != composition.storyboard_sha256
                else f"source {voice.provenance.source_sha256[:12]}",
            ),
            _gate(
                "voice_provider_is_recorded",
                GateGroup.VOICE,
                bool(voice.provider and voice.model and voice.voice)
                and (audio.voice_provider, audio.voice_model) == (voice.provider, voice.model),
                f"{voice.provider}:{voice.model} voice '{voice.voice}'",
            ),
            _gate(
                "voice_language_matches_the_plan",
                GateGroup.VOICE,
                voice.language is plan.language,
                f"{voice.language.value}, the plan is in {plan.language.value}",
            ),
            _gate(
                "voice_passed_its_own_validation",
                GateGroup.VOICE,
                voice.passed,
                "voice.json records no validation"
                if voice.validation is None
                else f"{len(voice.validation.checks)} checks",
            ),
        ]
    )
    gates.extend(_voice_file_gates(audio.voice_path, audio.voice_sha256, voice, probe))
    gates.extend(_speech_gates(voice, composition))
    return gates


def _voice_file_gates(
    path: Path,
    mixed_sha256: str | None,
    voice: VoiceAsset | None,
    probe: AudioProbe | None,
) -> list[QualityGate]:
    """The narration file has to still be there, and still be the same audio."""
    if not path.is_file():
        return [_gate("voice_file_exists", GateGroup.VOICE, False, f"{path} does not exist")]

    gates = [_gate("voice_file_exists", GateGroup.VOICE, True, str(path))]
    digest = sha256_file(path)
    if mixed_sha256:
        gates.append(
            _gate(
                "voice_file_is_unchanged",
                GateGroup.VOICE,
                digest == mixed_sha256,
                "the narration changed after the Reel was composed"
                if digest != mixed_sha256
                else f"sha256 {digest[:12]}",
            )
        )
    if voice is not None and voice.sha256:
        gates.append(
            _gate(
                "voice_file_matches_its_record",
                GateGroup.VOICE,
                digest == voice.sha256,
                "the narration does not match the hash in voice.json"
                if digest != voice.sha256
                else f"sha256 {digest[:12]}",
            )
        )
    if probe is None:
        return gates
    try:
        info = probe.inspect_audio(path)
    except ProbeError as error:
        gates.append(_gate("voice_audio_is_readable", GateGroup.VOICE, False, str(error)))
        return gates
    gates.append(
        _gate(
            "voice_audio_is_readable",
            GateGroup.VOICE,
            info.audio_streams >= 1 and info.duration_seconds > 0,
            f"{info.duration_seconds}s of {info.codec} at {info.sample_rate} Hz, "
            f"{info.channels} channel(s)",
        )
    )
    if voice is not None and voice.duration_seconds:
        drift = abs(info.duration_seconds - voice.duration_seconds)
        gates.append(
            _gate(
                "voice_duration_matches_its_record",
                GateGroup.VOICE,
                drift <= VOICE_TIMELINE_TOLERANCE_SECONDS,
                f"{info.duration_seconds}s against a recorded {voice.duration_seconds}s",
            )
        )
    return gates


def _speech_gates(voice: VoiceAsset, composition: Composition) -> list[QualityGate]:
    """The narration has to be hearable in full, at a sane speaking rate."""
    metrics = voice.metrics
    if metrics is None:
        return [
            _gate(
                "narration_was_measured",
                GateGroup.VOICE,
                False,
                "voice.json records no speech measurement",
            )
        ]
    timeline = composition.timeline_duration_seconds
    fits = metrics.duration_seconds <= timeline + VOICE_TIMELINE_TOLERANCE_SECONDS
    return [
        _gate("narration_was_measured", GateGroup.VOICE, True, f"{metrics.duration_seconds}s"),
        _gate(
            "narration_fits_the_reel",
            GateGroup.VOICE,
            fits,
            f"{metrics.duration_seconds}s of speech in a {timeline}s Reel "
            f"({round(timeline - metrics.duration_seconds, 2):+} s)",
        ),
        _gate(
            "speech_rate_is_reasonable",
            GateGroup.VOICE,
            voice.passed,
            f"{metrics.characters_per_second} characters per second, "
            f"{metrics.words_per_minute} words per minute",
        ),
    ]
