"""Building the composition timeline.

Everything creative was decided in Phases 2 and 3. This module turns those
decisions into exact instructions — which clip, trimmed where, scaled and
cropped how, with which caption on screen between which seconds — without
consulting a model and without changing a single approved value.

The storyboard's timing is authoritative: the finished timeline lands on the
storyboard's target duration exactly.
"""

from __future__ import annotations

import math
from pathlib import Path

from maingott_reel.assets.probe import MediaProbe, ProbeError
from maingott_reel.errors import CompositionError
from maingott_reel.models import (
    Asset,
    AssetCollection,
    AudioPlan,
    CaptionCue,
    CompositionSettings,
    CropPolicy,
    ScaleCrop,
    Scene,
    SceneTransition,
    Storyboard,
    TextRole,
    TimelineScene,
    VoiceAsset,
)
from maingott_reel.utils.hashing import sha256_file, sha256_text
from maingott_reel.utils.jsonio import dumps

#: Transitions post-production knows how to render.
SUPPORTED_TRANSITIONS = (SceneTransition.CUT, SceneTransition.FADE, SceneTransition.DISSOLVE)


def scale_and_crop(
    source_width: int,
    source_height: int,
    settings: CompositionSettings,
) -> ScaleCrop:
    """Fit a clip onto the canvas without distorting it.

    The clip is scaled until it covers the canvas in both directions, then the
    excess is cropped equally from both sides. Dimensions are rounded up to
    even numbers because the output pixel format needs them.

    Raises:
        CompositionError: the source has no usable dimensions.
    """
    if source_width <= 0 or source_height <= 0:
        raise CompositionError(f"Clip reports no usable size ({source_width}x{source_height}).")

    factor = max(settings.width / source_width, settings.height / source_height)
    scaled_width = max(settings.width, _even(math.ceil(source_width * factor)))
    scaled_height = max(settings.height, _even(math.ceil(source_height * factor)))
    return ScaleCrop(
        source_width=source_width,
        source_height=source_height,
        scaled_width=scaled_width,
        scaled_height=scaled_height,
        crop_x=(scaled_width - settings.width) // 2,
        crop_y=(scaled_height - settings.height) // 2,
        output_width=settings.width,
        output_height=settings.height,
        policy=settings.crop_policy if settings.crop_policy else CropPolicy.CENTER,
    )


def _even(value: int) -> int:
    """Round up to the next even number."""
    return value if value % 2 == 0 else value + 1


def resolve_transition(
    scene: Scene,
    surplus_seconds: float,
    is_last: bool,
    settings: CompositionSettings,
) -> float:
    """Return the overlap a scene's transition needs, in seconds.

    A cut needs none. A fade is drawn inside the scenes' own time, so it needs
    none either. A dissolve overlaps the next scene, and that overlap is paid
    for out of the surplus footage the clip already has — so no scene loses
    screen time and the timeline still lands on the target duration.

    Raises:
        CompositionError: the transition is unsupported, impossible at this
            position, or there is not enough surplus footage to fund it.
    """
    if scene.transition not in SUPPORTED_TRANSITIONS:
        raise CompositionError(
            f"Scene {scene.id} asks for a '{scene.transition.value}' transition, which "
            f"post-production does not implement."
        )
    if scene.transition is not SceneTransition.DISSOLVE:
        return 0.0
    if is_last:
        raise CompositionError(
            f"Scene {scene.id} is the last scene and cannot dissolve into anything. "
            "Use 'fade' or 'cut' for the closing scene."
        )
    if surplus_seconds < settings.min_transition_seconds:
        raise CompositionError(
            f"Scene {scene.id} has only {surplus_seconds:.2f}s of surplus footage, which is "
            f"too little for a dissolve (minimum {settings.min_transition_seconds}s). "
            "Regenerate a longer clip or change the transition."
        )
    return round(min(settings.transition_seconds, surplus_seconds), 3)


def _asset_duration(asset: Asset) -> float:
    """The length of the generated clip, as measured or as requested."""
    return float(
        asset.actual_duration_seconds
        or asset.generated_duration_seconds
        or asset.requested_duration_seconds
        or 0.0
    )


def build_timeline(
    storyboard: Storyboard,
    assets: AssetCollection,
    settings: CompositionSettings,
    probe: MediaProbe | None = None,
) -> list[TimelineScene]:
    """Turn scenes and their assets into an exact timeline.

    Raises:
        CompositionError: an asset is missing or unusable, or a scene cannot
            be realised with the transition it declares.
    """
    scenes: list[TimelineScene] = []
    start = 0.0
    for position, scene in enumerate(storyboard.scenes, start=1):
        asset = assets.for_scene(scene.id)
        if asset is None:
            raise CompositionError(f"Scene {scene.id} has no generated asset.")
        if not asset.is_usable:
            raise CompositionError(
                f"Scene {scene.id} has an asset with status '{asset.status.value}': "
                f"{asset.error or 'not usable'}."
            )
        if asset.path is None or not asset.path.is_file():
            raise CompositionError(f"The asset file for scene {scene.id} is missing.")

        width, height = asset.actual_width or 0, asset.actual_height or 0
        source_duration = _asset_duration(asset)
        if probe is not None:
            try:
                info = probe.inspect(asset.path)
            except ProbeError as error:
                raise CompositionError(
                    f"The asset for scene {scene.id} cannot be read: {error}"
                ) from error
            width, height, source_duration = info.width, info.height, info.duration_seconds

        surplus = round(source_duration - scene.duration_seconds, 3)
        if surplus < -0.05:
            raise CompositionError(
                f"Scene {scene.id} needs {scene.duration_seconds}s but its clip is only "
                f"{source_duration}s. Regenerate the asset."
            )
        overlap = resolve_transition(
            scene,
            surplus_seconds=max(surplus, 0.0),
            is_last=position == len(storyboard.scenes),
            settings=settings,
        )
        trim_duration = round(min(scene.duration_seconds + overlap, source_duration), 3)

        scenes.append(
            TimelineScene(
                scene_id=scene.id,
                beat_id=scene.beat_id,
                order=position,
                asset_id=asset.id,
                source_path=asset.path,
                source_duration_seconds=source_duration,
                trim_start_seconds=0.0,
                trim_duration_seconds=trim_duration,
                start_seconds=round(start, 3),
                duration_seconds=scene.duration_seconds,
                transition=scene.transition,
                transition_seconds=overlap,
                geometry=scale_and_crop(width, height, settings),
            )
        )
        start = round(start + scene.duration_seconds, 3)
    return scenes


def build_captions(storyboard: Storyboard, settings: CompositionSettings) -> list[CaptionCue]:
    """Turn the approved overlay text into timed caption cues.

    The wording is copied verbatim from the storyboard. The closing scene gets
    the brand treatment; every other caption is a plain caption.
    """
    cues: list[CaptionCue] = []
    for position, scene in enumerate(storyboard.scenes, start=1):
        text = scene.overlay_text.strip()
        if not text:
            continue
        is_last = position == len(storyboard.scenes)
        start = scene.start_seconds + settings.caption_lead_in_seconds
        end = scene.end_seconds - settings.caption_lead_out_seconds
        if end - start < 0.4:  # too short to read: show it for the whole scene
            start, end = scene.start_seconds, scene.end_seconds
        cues.append(
            CaptionCue(
                id=f"C-{len(cues) + 1:02d}",
                scene_id=scene.id,
                text=text,
                role=TextRole.BRAND if is_last else TextRole.CAPTION,
                start_seconds=round(start, 3),
                end_seconds=round(min(end, storyboard.total_duration_seconds), 3),
            )
        )
    return cues


def build_audio_plan(
    voice_path: Path | None,
    music_path: Path | None,
    settings: CompositionSettings,
    silent: bool = False,
    voice: VoiceAsset | None = None,
) -> AudioPlan:
    """Describe the soundtrack.

    When the narration came from the voice stage, its provenance travels with
    the plan, so the finished Reel records which approved narration was spoken
    and what produced it.

    Raises:
        CompositionError: a supplied audio file is missing.
    """
    for label, path in (("voice", voice_path), ("music", music_path)):
        if path is not None and not path.is_file():
            raise CompositionError(f"The {label} track does not exist: {path}")

    return AudioPlan(
        voice_path=voice_path,
        voice_sha256=sha256_file(voice_path) if voice_path else None,
        voice_duration_seconds=voice.duration_seconds if voice else None,
        voice_asset_id=voice.id if voice else None,
        voice_provider=voice.provider if voice else None,
        voice_model=voice.model if voice else None,
        voice_name=voice.voice if voice else None,
        voice_narration_sha256=voice.narration_sha256 if voice else None,
        voice_is_development=bool(voice and voice.development),
        music_path=music_path,
        music_sha256=sha256_file(music_path) if music_path else None,
        music_gain_db=-18.0,
        silent=silent or voice_path is None,
    )


def composition_identity(
    storyboard_sha256: str,
    assets_sha256: str,
    audio: AudioPlan,
    logo_sha256: str | None,
    font_identity: str,
    settings: CompositionSettings,
    version: str,
) -> str:
    """Hash everything that decides what the finished file looks like.

    Change any input — a scene, a clip, the narration, the music, the logo,
    the font, a setting — and the identity changes, so an obsolete Reel is
    never mistaken for a current one.
    """
    payload = {
        "version": version,
        "storyboard": storyboard_sha256,
        "assets": assets_sha256,
        "voice": audio.voice_sha256,
        "voice_narration": audio.voice_narration_sha256,
        "voice_development": audio.voice_is_development,
        "music": audio.music_sha256,
        "silent": audio.silent,
        "voice_gain_db": audio.voice_gain_db,
        "music_gain_db": audio.music_gain_db,
        "logo": logo_sha256,
        "font": font_identity,
        "settings": settings.model_dump(mode="json"),
    }
    return sha256_text(dumps(payload).decode("utf-8"))


def assets_identity(assets: AssetCollection) -> str:
    """Hash the exact set of clips a composition is built from."""
    payload = sorted(
        (asset.scene_id or "", asset.id, asset.sha256 or "") for asset in assets.assets
    )
    return sha256_text(dumps(payload).decode("utf-8"))
