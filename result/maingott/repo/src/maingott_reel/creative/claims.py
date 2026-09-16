"""Deterministic validation of a generated plan.

The model is instructed to obey the claims policy, but the application does not
trust it to. Every rule in ``docs/creative/CLAIMS_POLICY.md`` that can be
checked mechanically is checked here, after generation, against the Phase 1
fact registry. A plan that fails any check is rejected — it is never repaired
in place, because silently rewriting an unsupported claim would hide exactly
the problem this stage exists to catch.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

from maingott_reel.models import (
    AssetType,
    BeatKind,
    ClaimKind,
    ClaimStatus,
    CreativeBrief,
    FactRegistry,
    Language,
    Scene,
    ScriptBeat,
    ScriptPlan,
    ValidationCheck,
    ValidationReport,
)

#: A plan must rest on at least this many distinct facts to count as sourced.
MIN_DISTINCT_FACTS = 3

#: Sane bounds for a ~40 second Reel of roughly eight beats.
MIN_BEATS = 5
MAX_BEATS = 12

#: Spoken characters per second, and how far above it a line may be packed.
SPEECH_RATE_CPS: dict[Language, float] = {Language.RU: 15.0, Language.EN: 17.0}
SPEECH_RATE_TOLERANCE = 1.35

#: Superlatives and absolute claims that the specification does not support.
BANNED_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bлучш", re.IGNORECASE),
    re.compile(r"№\s?1|\bномер один\b", re.IGNORECASE),
    re.compile(r"\bгарантиру|\bгарантия\b", re.IGNORECASE),
    re.compile(r"\bреволюцион|\bпрорывн|\bбеспрецедент|\bуникальн", re.IGNORECASE),
    re.compile(r"\bмгновенн", re.IGNORECASE),
    re.compile(r"100\s?%|\bполностью автоматич|\bполностью автономн", re.IGNORECASE),
    re.compile(r"\brevolutionary\b|\bgame[- ]changing\b|\bunprecedented\b", re.IGNORECASE),
    re.compile(r"\bguaranteed\b|\bworld'?s best\b|\bbest[- ]in[- ]class\b", re.IGNORECASE),
    re.compile(r"\bfully autonomous\b|\b100% automated\b", re.IGNORECASE),
)

#: Wording that introduces a person rather than the platform.
TEAM_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"меня зовут|нас зовут|знакомьтесь", re.IGNORECASE),
    re.compile(r"\bосновател|\bсоосновател", re.IGNORECASE),
    re.compile(r"наша команда\s*[—:-]", re.IGNORECASE),
    re.compile(r"\bfounder\b|\bco-founder\b|\bmy name is\b", re.IGNORECASE),
    re.compile(r"\bCEO\b|\bCTO\b|\bCOO\b"),
)

#: Wording that keeps a design target recognisable as a target.
TARGET_PRESERVING_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bцел[ьи]\b|\bцелев", re.IGNORECASE),
    re.compile(r"\bпланиру|\bзаложен|\bпроектиру|\bстремим|\bпо замыслу", re.IGNORECASE),
    re.compile(r"\bзадан|\bориентир", re.IGNORECASE),
    re.compile(r"\btarget\b|\bgoal\b|\bdesigned to\b|\baims? to\b|\bby design\b", re.IGNORECASE),
)

#: Wording that turns a target into an achieved result.
ACHIEVED_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bуже\b|\bвсегда\b|\bкаждый раз\b|\bфактическ", re.IGNORECASE),
    re.compile(r"\balready\b|\bachieved\b|\bevery time\b|\bconsistently\b", re.IGNORECASE),
)

#: Readable text must never be baked into generated footage: it comes out
#: malformed, and every caption and logo is added in post-production.
TEXT_IN_FOOTAGE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\btext\b|\bwords?\b|\bletters?\b|\bwriting\b|\bwritten\b", re.IGNORECASE),
    re.compile(r"\bcaptions?\b|\bsubtitles?\b|\btitles?\b|\bheadlines?\b", re.IGNORECASE),
    re.compile(r"\blogos?\b|\bwordmark\b|\bwatermark\b|\bbranding\b", re.IGNORECASE),
    re.compile(r"\btypograph|\bfonts?\b|\blabels?\b|\bsignage\b|\bslogan\b", re.IGNORECASE),
    re.compile(r"\bnumbers?\b|\bdigits?\b|\bpercentages?\b", re.IGNORECASE),
)

#: Visual clichés the creative brief rules out, plus people as the subject.
FORBIDDEN_VISUAL_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\brobots?\b|\bhumanoid\b|\bandroid\b|\bcyborg\b", re.IGNORECASE),
    re.compile(r"\bcode rain\b|\bmatrix\b|\bcyberpunk\b|\bhologram girl\b", re.IGNORECASE),
    re.compile(r"\bcartoon\b|\banime\b|\bcomic\b|\billustrated character\b", re.IGNORECASE),
    re.compile(
        r"\bstock office\b|\boffice workers?\b|\bbusiness(man|woman|people)\b", re.IGNORECASE
    ),
    re.compile(r"\bportrait of\b|\bsmiling (man|woman|person|team)\b|\bactors?\b", re.IGNORECASE),
    re.compile(r"\bteam (of people|meeting|photo)\b|\bcrowd of people\b", re.IGNORECASE),
)

#: Shot prompts are written in English for the video model.
_CYRILLIC = re.compile(r"[а-яё]", re.IGNORECASE)

#: Sane bounds for a text-to-video prompt.
MIN_VIDEO_PROMPT_CHARS = 40
MAX_VIDEO_PROMPT_CHARS = 1200

#: Leftovers that must never survive into an artifact.
PLACEHOLDER_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bTODO\b|\bTBD\b|\bFIXME\b|\blorem ipsum\b", re.IGNORECASE),
    re.compile(r"\{\{.*?\}\}|<placeholder>|XXX+", re.IGNORECASE),
)

_MAINGOTT = re.compile(r"maingott|майнготт", re.IGNORECASE)
_DIGIT = re.compile(r"\d")


@dataclass(frozen=True)
class ClaimPolicy:
    """The rules a plan is held to.

    Defaults follow ``docs/creative/CLAIMS_POLICY.md``: design targets are kept
    out of the first Reel unless a run explicitly opts in.
    """

    target_duration_seconds: int
    min_duration_seconds: int = 30
    max_duration_seconds: int = 45
    language: Language = Language.RU
    allow_target_facts: bool = False
    min_distinct_facts: int = MIN_DISTINCT_FACTS
    min_beats: int = MIN_BEATS
    max_beats: int = MAX_BEATS
    offered_fact_ids: frozenset[str] = field(default_factory=frozenset)


def _matches(patterns: tuple[re.Pattern[str], ...], text: str) -> list[str]:
    """Return the fragments of ``text`` that match any pattern."""
    found: list[str] = []
    for pattern in patterns:
        found.extend(match.group(0) for match in pattern.finditer(text))
    return found


def _beat_text(beat: ScriptBeat) -> str:
    """All viewer-facing text of a beat."""
    return f"{beat.narration}\n{beat.on_screen_text}"


def _check(name: str, failures: list[str], ok_detail: str | None = None) -> ValidationCheck:
    """Build a check result from a list of failure descriptions."""
    if failures:
        return ValidationCheck(name=name, passed=False, detail="; ".join(failures[:8]))
    return ValidationCheck(name=name, passed=True, detail=ok_detail)


def _check_claims_have_sources(beats: list[ScriptBeat]) -> ValidationCheck:
    failures: list[str] = []
    for beat in beats:
        for claim in beat.claims:
            if not claim.source_fact_ids:
                failures.append(f"{beat.id}: claim without source_fact_ids")
            if not claim.claim.strip():
                failures.append(f"{beat.id}: empty claim text")
    return _check("claims_have_sources", failures)


def _check_beats_cite_facts(beats: list[ScriptBeat]) -> ValidationCheck:
    failures: list[str] = []
    for beat in beats:
        if beat.kind is BeatKind.FRAMING:
            if beat.claims:
                failures.append(f"{beat.id}: framing beat carries claims")
            if _MAINGOTT.search(_beat_text(beat)):
                failures.append(f"{beat.id}: framing beat names MainGott")
            if _DIGIT.search(_beat_text(beat)):
                failures.append(f"{beat.id}: framing beat contains numbers")
        elif not beat.claims:
            failures.append(f"{beat.id}: {beat.kind.value} beat cites no facts")
    return _check("beats_cite_facts", failures)


def _check_facts_exist(
    beats: list[ScriptBeat], brief: CreativeBrief, registry: FactRegistry
) -> ValidationCheck:
    referenced = _referenced_ids(beats) | set(brief.source_fact_ids)
    unknown = sorted(registry.unknown_ids(sorted(referenced)))
    failures = [f"unknown fact ids: {', '.join(unknown)}"] if unknown else []
    return _check("facts_exist", failures, f"{len(referenced)} fact ids referenced")


def _check_no_unsupported_facts(beats: list[ScriptBeat], registry: FactRegistry) -> ValidationCheck:
    failures = []
    for fact_id in sorted(_referenced_ids(beats)):
        fact = registry.get(fact_id)
        if fact is not None and fact.claim_status is ClaimStatus.UNSUPPORTED:
            failures.append(f"{fact_id} is unsupported")
    return _check("no_unsupported_facts", failures)


def _check_facts_were_offered(beats: list[ScriptBeat], policy: ClaimPolicy) -> ValidationCheck:
    if not policy.offered_fact_ids:
        return ValidationCheck(
            name="facts_were_offered", passed=True, detail="no offered set recorded"
        )
    outside = sorted(_referenced_ids(beats) - set(policy.offered_fact_ids))
    failures = [f"facts not offered to the planner: {', '.join(outside)}"] if outside else []
    return _check("facts_were_offered", failures)


def _check_target_facts(
    beats: list[ScriptBeat], registry: FactRegistry, policy: ClaimPolicy
) -> ValidationCheck:
    """Design targets must never read as achieved results."""
    failures: list[str] = []
    for beat in beats:
        for claim in beat.claims:
            target_ids = [
                fact_id
                for fact_id in claim.source_fact_ids
                if (fact := registry.get(fact_id)) is not None
                and fact.claim_status is ClaimStatus.TARGET
            ]
            if not target_ids:
                continue
            listed = ", ".join(target_ids)
            if not policy.allow_target_facts:
                failures.append(f"{beat.id}: target facts are not allowed in this run ({listed})")
                continue
            if claim.kind is not ClaimKind.TARGET:
                failures.append(f"{beat.id}: target facts {listed} used in a factual claim")
                continue
            if not _matches(TARGET_PRESERVING_PATTERNS, claim.claim):
                failures.append(f"{beat.id}: claim on {listed} does not read as a target")
            achieved = _matches(ACHIEVED_PATTERNS, claim.claim)
            if achieved:
                failures.append(
                    f"{beat.id}: claim on {listed} presents a target as achieved "
                    f"({', '.join(achieved)})"
                )
    return _check("target_facts_not_presented_as_achieved", failures)


def _check_fact_coverage(beats: list[ScriptBeat], policy: ClaimPolicy) -> ValidationCheck:
    distinct = _referenced_ids(beats)
    failures = []
    if len(distinct) < policy.min_distinct_facts:
        failures.append(
            f"plan cites {len(distinct)} distinct facts, at least "
            f"{policy.min_distinct_facts} required"
        )
    return _check("fact_coverage", failures, f"{len(distinct)} distinct facts")


def _check_banned_language(beats: list[ScriptBeat], brief: CreativeBrief) -> ValidationCheck:
    failures: list[str] = []
    for beat in beats:
        found = _matches(BANNED_PATTERNS, _beat_text(beat))
        if found:
            failures.append(f"{beat.id}: {', '.join(sorted(set(found)))}")
    brief_text = f"{brief.core_message}\n{' '.join(brief.supporting_messages)}\n{brief.cta}"
    found = _matches(BANNED_PATTERNS, brief_text)
    if found:
        failures.append(f"brief: {', '.join(sorted(set(found)))}")
    return _check("no_unsupported_superlatives", failures)


def _check_no_team_members(beats: list[ScriptBeat], brief: CreativeBrief) -> ValidationCheck:
    failures: list[str] = []
    for beat in beats:
        found = _matches(TEAM_PATTERNS, _beat_text(beat))
        if found:
            failures.append(f"{beat.id}: {', '.join(sorted(set(found)))}")
    found = _matches(TEAM_PATTERNS, brief.objective + "\n" + brief.core_message)
    if found:
        failures.append(f"brief: {', '.join(sorted(set(found)))}")
    return _check("no_team_members", failures)


def _check_no_placeholders(beats: list[ScriptBeat], brief: CreativeBrief) -> ValidationCheck:
    failures: list[str] = []
    for beat in beats:
        found = _matches(PLACEHOLDER_PATTERNS, _beat_text(beat))
        if found:
            failures.append(f"{beat.id}: {', '.join(sorted(set(found)))}")
    found = _matches(PLACEHOLDER_PATTERNS, brief.core_message + "\n" + brief.cta)
    if found:
        failures.append(f"brief: {', '.join(sorted(set(found)))}")
    return _check("no_placeholder_text", failures)


def _check_duration(beats: list[ScriptBeat], policy: ClaimPolicy) -> ValidationCheck:
    total = round(sum(beat.estimated_seconds for beat in beats), 2)
    failures = []
    if not policy.min_duration_seconds <= total <= policy.max_duration_seconds:
        failures.append(
            f"planned {total}s is outside "
            f"{policy.min_duration_seconds}-{policy.max_duration_seconds}s"
        )
    return _check("duration_within_bounds", failures, f"{total}s planned")


def _check_beat_count(beats: list[ScriptBeat], policy: ClaimPolicy) -> ValidationCheck:
    failures = []
    if not policy.min_beats <= len(beats) <= policy.max_beats:
        failures.append(f"{len(beats)} beats, expected {policy.min_beats}-{policy.max_beats}")
    return _check("beat_count", failures, f"{len(beats)} beats")


def _check_speech_rate(beats: list[ScriptBeat], policy: ClaimPolicy) -> ValidationCheck:
    """Narration must be speakable in the seconds the plan assigns to it."""
    rate = SPEECH_RATE_CPS[policy.language] * SPEECH_RATE_TOLERANCE
    failures = []
    for beat in beats:
        needed = len(beat.narration) / rate
        if needed > beat.estimated_seconds:
            failures.append(
                f"{beat.id}: {len(beat.narration)} characters need about "
                f"{needed:.1f}s but only {beat.estimated_seconds}s are planned"
            )
    return _check("speech_rate", failures)


def _referenced_ids(beats: list[ScriptBeat]) -> set[str]:
    """Every fact id cited by any beat."""
    return {fact_id for beat in beats for fact_id in beat.source_fact_ids}


def validate_plan(
    beats: list[ScriptBeat],
    brief: CreativeBrief,
    registry: FactRegistry,
    policy: ClaimPolicy,
    created_at: datetime | None = None,
) -> ValidationReport:
    """Run every deterministic claim and quality check.

    Returns a report; the caller decides what to do with a failure. The report
    is stored with the plan so a reviewer can see exactly what was verified.
    """
    checks = [
        _check_claims_have_sources(beats),
        _check_beats_cite_facts(beats),
        _check_facts_exist(beats, brief, registry),
        _check_no_unsupported_facts(beats, registry),
        _check_facts_were_offered(beats, policy),
        _check_target_facts(beats, registry, policy),
        _check_fact_coverage(beats, policy),
        _check_banned_language(beats, brief),
        _check_no_team_members(beats, brief),
        _check_no_placeholders(beats, brief),
        _check_duration(beats, policy),
        _check_beat_count(beats, policy),
        _check_speech_rate(beats, policy),
    ]
    return ValidationReport(created_at=created_at or datetime.now(tz=UTC), checks=checks)


def failure_feedback(report: ValidationReport) -> str:
    """Render failed checks as instructions the planner can act on."""
    lines = [f"- {check.name}: {check.detail}" for check in report.failures]
    return "\n".join(lines)


# --- storyboard ----------------------------------------------------------


def _check_scenes_match_beats(scenes: list[Scene], plan: ScriptPlan) -> ValidationCheck:
    """One scene per beat, in the plan's order."""
    expected = [beat.id for beat in plan.beats]
    actual = [scene.beat_id for scene in scenes]
    failures = []
    if actual != expected:
        failures.append(f"scenes realise {actual}, expected {expected}")
    return _check("scenes_match_beats", failures, f"{len(scenes)} scenes")


def _check_spoken_content_is_unchanged(scenes: list[Scene], plan: ScriptPlan) -> ValidationCheck:
    """Voiceover, captions and fact references must come from the plan verbatim."""
    beats = {beat.id: beat for beat in plan.beats}
    failures: list[str] = []
    for scene in scenes:
        beat = beats.get(scene.beat_id)
        if beat is None:
            failures.append(f"{scene.id}: unknown beat {scene.beat_id}")
            continue
        if scene.voiceover != beat.narration:
            failures.append(f"{scene.id}: voiceover was rewritten")
        if scene.overlay_text != beat.on_screen_text:
            failures.append(f"{scene.id}: overlay text was rewritten")
        if scene.source_fact_ids != beat.source_fact_ids:
            failures.append(f"{scene.id}: fact references differ from beat {beat.id}")
    return _check("spoken_content_unchanged", failures)


def _check_timeline(scenes: list[Scene], target_seconds: int) -> ValidationCheck:
    """The timeline must be gapless and land on the target duration."""
    failures: list[str] = []
    cursor = 0.0
    for scene in scenes:
        if abs(scene.start_seconds - cursor) > 0.05:
            failures.append(f"{scene.id}: starts at {scene.start_seconds}s, expected {cursor}s")
        cursor = scene.end_seconds
    if abs(cursor - target_seconds) > 0.05:
        failures.append(f"timeline covers {cursor}s, expected {target_seconds}s")
    return _check("timeline_is_contiguous", failures, f"{round(cursor, 2)}s")


def _check_scene_durations(scenes: list[Scene]) -> ValidationCheck:
    """Each clip must be long enough to be worth generating and short enough to generate."""
    from maingott_reel.creative.storyboard_generator import MAX_SCENE_SECONDS, MIN_SCENE_SECONDS

    failures = [
        f"{scene.id}: {scene.duration_seconds}s is outside {MIN_SCENE_SECONDS}-{MAX_SCENE_SECONDS}s"
        for scene in scenes
        if not MIN_SCENE_SECONDS <= scene.duration_seconds <= MAX_SCENE_SECONDS
    ]
    return _check("scene_durations", failures)


def _check_no_text_in_footage(scenes: list[Scene]) -> ValidationCheck:
    """Generated footage must not be asked to render readable text or a logo."""
    failures: list[str] = []
    for scene in scenes:
        found = _matches(TEXT_IN_FOOTAGE_PATTERNS, scene.video_prompt)
        if found:
            failures.append(f"{scene.id}: {', '.join(sorted(set(found)))}")
    return _check("no_text_in_footage", failures)


def _check_visual_style(scenes: list[Scene]) -> ValidationCheck:
    """Reject the clichés the creative brief rules out."""
    failures: list[str] = []
    for scene in scenes:
        found = _matches(
            FORBIDDEN_VISUAL_PATTERNS, f"{scene.video_prompt}\n{scene.visual_description}"
        )
        if found:
            failures.append(f"{scene.id}: {', '.join(sorted(set(found)))}")
    return _check("visual_style", failures)


def _check_video_prompts(scenes: list[Scene]) -> ValidationCheck:
    """Shot prompts must be usable: English, concrete, not truncated."""
    failures: list[str] = []
    for scene in scenes:
        length = len(scene.video_prompt)
        if not MIN_VIDEO_PROMPT_CHARS <= length <= MAX_VIDEO_PROMPT_CHARS:
            failures.append(
                f"{scene.id}: prompt is {length} characters, expected "
                f"{MIN_VIDEO_PROMPT_CHARS}-{MAX_VIDEO_PROMPT_CHARS}"
            )
        if _CYRILLIC.search(scene.video_prompt):
            failures.append(f"{scene.id}: prompt must be written in English")
    return _check("video_prompts_are_usable", failures)


def _check_assets_are_declared(scenes: list[Scene]) -> ValidationCheck:
    """Every scene must declare the footage it needs, matching its own timing."""
    failures: list[str] = []
    for scene in scenes:
        video = [
            requirement
            for requirement in scene.asset_requirements
            if requirement.asset_type is AssetType.VIDEO
        ]
        if not video:
            failures.append(f"{scene.id}: no video asset requirement")
            continue
        if len(video) > 1:
            failures.append(f"{scene.id}: {len(video)} video assets, expected one")
        requirement = video[0]
        if requirement.prompt != scene.video_prompt:
            failures.append(f"{scene.id}: asset prompt differs from the scene prompt")
        if requirement.duration_seconds != scene.duration_seconds:
            failures.append(f"{scene.id}: asset duration differs from the scene duration")
    return _check("assets_are_declared", failures)


def _check_no_storyboard_placeholders(scenes: list[Scene]) -> ValidationCheck:
    """No leftover scaffolding in prompts or notes."""
    failures: list[str] = []
    for scene in scenes:
        found = _matches(PLACEHOLDER_PATTERNS, f"{scene.video_prompt}\n{scene.visual_description}")
        if found:
            failures.append(f"{scene.id}: {', '.join(sorted(set(found)))}")
    return _check("no_placeholder_text", failures)


def validate_storyboard(
    scenes: list[Scene],
    plan: ScriptPlan,
    target_seconds: int,
    created_at: datetime | None = None,
) -> ValidationReport:
    """Run every deterministic storyboard check.

    The claims themselves were already validated when the plan was accepted;
    what matters here is that the storyboard carries them over unchanged and
    that the shots are executable.
    """
    checks = [
        _check_scenes_match_beats(scenes, plan),
        _check_spoken_content_is_unchanged(scenes, plan),
        _check_timeline(scenes, target_seconds),
        _check_scene_durations(scenes),
        _check_no_text_in_footage(scenes),
        _check_visual_style(scenes),
        _check_video_prompts(scenes),
        _check_assets_are_declared(scenes),
        _check_no_storyboard_placeholders(scenes),
    ]
    return ValidationReport(created_at=created_at or datetime.now(tz=UTC), checks=checks)
