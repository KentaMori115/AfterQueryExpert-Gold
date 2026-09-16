"""Speaking the approved narration one scene at a time.

Nothing here needs a key, a network or a paid call: the offline provider
writes real audio and every deviation from it is scripted.
"""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from maingott_reel.audio.voice import generate_voice, voice_track
from maingott_reel.audio.wav import parse_wav, tone_samples, write_wav
from maingott_reel.config import Settings
from maingott_reel.creative.claims import validate_storyboard
from maingott_reel.creative.draft import DraftShot, StoryboardDraft
from maingott_reel.creative.storyboard_generator import build_scenes, build_storyboard
from maingott_reel.models import (
    TIMELINE_TOLERANCE_SECONDS,
    AssetStatus,
    ScriptPlan,
    Storyboard,
    VoiceAsset,
    VoiceFitStrategy,
)
from maingott_reel.providers.base import MediaResult, Usage
from maingott_reel.providers.fake import OfflineVoiceProvider
from maingott_reel.utils.hashing import sha256_text
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext

SAMPLE_RATE = 24000

#: Long enough to overrun a five second scene, short enough to fit a wider one.
A_LONG_LINE = "Слово " * 13 + "конец"

#: No speaking speed anybody would accept can fit this into five seconds.
TOO_LONG_A_LINE = "Слово " * 20


def scene_by_scene(settings: Settings, monkeypatch: pytest.MonkeyPatch, **overrides: object) -> Settings:
    """Settings that ask for one take per storyboard scene."""
    monkeypatch.setenv("VOICE_TAKES", "scene")
    return Settings(
        output_root=settings.output_root,
        input_root=settings.input_root,
        **overrides,  # type: ignore[arg-type]
    )


def speak(settings: Settings, run: RunContext, **kwargs: object) -> object:
    """Run the narration stage offline."""
    return generate_voice(settings, run_id=run.run_id, offline=True, **kwargs)  # type: ignore[arg-type]


def stored(run: RunContext) -> VoiceAsset:
    """The narration record the stage wrote."""
    return read_model(run.voice_json, VoiceAsset)


class FixedLength(OfflineVoiceProvider):
    """Speaks for the same number of seconds whatever the words are.

    Which makes the audio disagree with what a character count predicts, so a
    delivery decision taken from the words rather than from the recording is
    visible.
    """

    def __init__(self, seconds: float, **kwargs: object) -> None:
        super().__init__(**kwargs)  # type: ignore[arg-type]
        self._seconds = seconds

    def synthesize(self, **kwargs: object) -> MediaResult:  # type: ignore[override]
        destination = Path(str(kwargs["destination"]))
        speed = float(kwargs.get("speed") or 1.0)  # type: ignore[arg-type]
        seconds = self._seconds / speed
        self.calls.append({"characters": len(str(kwargs["text"])), "speed": kwargs.get("speed")})
        write_wav(
            destination, tone_samples(seconds, SAMPLE_RATE), sample_rate=SAMPLE_RATE, channels=1
        )
        return MediaResult(
            path=destination,
            usage=Usage(model=self.model, requests=1),
            duration_seconds=seconds,
            metadata={"offline": True},
        )


def shots_of(board: Storyboard) -> StoryboardDraft:
    """Rebuild the shot draft a storyboard was made from."""
    return StoryboardDraft(
        shots=[
            DraftShot(
                beat_id=scene.beat_id,
                visual_description=scene.visual_description,
                video_prompt=scene.video_prompt,
                transition=scene.transition.value,
            )
            for scene in board.scenes
        ]
    )


def rescale(run: RunContext, seconds: int) -> Storyboard:
    """Lay the same plan out over a Reel of a different length."""
    plan = read_model(run.script_json, ScriptPlan)
    board = read_model(run.storyboard_json, Storyboard)
    scenes = build_scenes(plan, shots_of(board), seconds)
    rebuilt = build_storyboard(
        scenes=scenes,
        plan=plan,
        target_seconds=seconds,
        language=board.language,
        validation=validate_storyboard(scenes, plan, seconds, created_at=board.created_at),
        provenance=board.provenance,
        created_at=board.created_at,
    )
    write_model(run.storyboard_json, rebuilt)
    return rebuilt


def say(run: RunContext, position: int, words: str, seconds: int = 40) -> Storyboard:
    """Give one beat different words, everywhere the pipeline keeps them."""
    plan = read_model(run.script_json, ScriptPlan)
    beats = list(plan.beats)
    beats[position] = beats[position].model_copy(update={"narration": words.strip()})
    write_model(
        run.script_json,
        plan.model_copy(
            update={"beats": beats, "narration": "\n".join(beat.narration for beat in beats)}
        ),
    )
    return rescale(run, seconds)


def samples_of(path: Path) -> tuple[int, bytes]:
    """Return a WAV's sample rate and its raw 16-bit frames.

    Read straight out of the container rather than through the project, so an
    assertion about where a take sits is about the audio itself.
    """
    raw = path.read_bytes()
    marker = raw.index(b"data")
    return parse_wav(path).sample_rate, raw[marker + 8 :]


def scene_seconds(board: Storyboard) -> dict[str, float]:
    """How long each scene runs, straight from the storyboard."""
    return {scene.id: scene.duration_seconds for scene in board.scenes}


def fits_its_scene(take, seconds: dict[str, float]) -> bool:
    """Whether a take can be heard inside its own scene.

    Computed from the storyboard and the tolerance the timeline check already
    allows, rather than asked of the take.
    """
    return take.duration_seconds <= seconds[take.scene_id] + TIMELINE_TOLERANCE_SECONDS


def loudness_at(path: Path, second: float) -> int:
    """How loud the finished track is at one instant."""
    rate, frames = samples_of(path)
    offset = round(second * rate) * 2
    window = frames[offset : offset + 2 * round(0.05 * rate)]
    values = struct.unpack(f"<{len(window) // 2}h", window[: len(window) // 2 * 2])
    return max((abs(value) for value in values), default=0)


# --- cutting the script -------------------------------------------------------


def test_every_scene_is_spoken_as_its_own_take(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    result = speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    assert result.complete
    asset = result.asset
    assert asset is not None
    assert [take.scene_id for take in asset.takes] == [scene.id for scene in board.scenes]


def test_a_whole_reel_take_is_still_the_default(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    result = speak(settings, storyboarded_run)

    assert result.complete
    assert result.asset is not None
    assert result.asset.takes == []


def test_each_take_carries_the_words_of_its_own_scene(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)
    provider = OfflineVoiceProvider()

    generate_voice(scene_by_scene(settings, monkeypatch), run_id=storyboarded_run.run_id, provider=provider)

    assert [call["characters"] for call in provider.calls] == [
        len(scene.voiceover) for scene in board.scenes
    ]


def test_the_track_still_speaks_for_the_whole_approved_script(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    asset = speak(scene_by_scene(settings, monkeypatch), storyboarded_run).asset

    assert asset is not None
    assert asset.narration_sha256 == sha256_text(plan.narration)
    assert asset.narration_sha256 == board.narration_sha256
    assert asset.status is AssetStatus.READY
    assert voice_track(storyboarded_run) is not None
    # One track, and it was built out of every scene.
    assert len(asset.takes) == len(board.scenes)


def test_the_record_survives_a_round_trip(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    asset = stored(storyboarded_run)
    assert asset.is_usable
    assert len(asset.takes) == 8
    assert asset.takes[0].scene_id == "S-01"


# --- laying the takes on the timeline -----------------------------------------


def test_a_take_starts_where_its_scene_starts(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    asset = speak(scene_by_scene(settings, monkeypatch), storyboarded_run).asset

    assert asset is not None
    assert [take.start_seconds for take in asset.takes] == [
        scene.start_seconds for scene in board.scenes
    ]


def test_the_finished_track_is_exactly_as_long_as_the_reel(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    asset = speak(scene_by_scene(settings, monkeypatch), storyboarded_run).asset

    assert asset is not None and asset.path is not None
    assert parse_wav(asset.path).duration_seconds == pytest.approx(
        board.total_duration_seconds, abs=0.01
    )


def test_the_audio_really_sits_where_the_record_says_it_does(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    asset = speak(scene_by_scene(settings, monkeypatch), storyboarded_run).asset

    assert asset is not None and asset.path is not None
    second = board.scenes[1]
    take = asset.takes[1]
    assert loudness_at(asset.path, second.start_seconds + 0.05) > 0
    # The third scene's words have not started yet, and the second scene's are
    # long over, so nothing is being said here.
    quiet = second.start_seconds + take.duration_seconds + 0.4
    assert loudness_at(asset.path, quiet) == 0


def test_a_short_take_does_not_drag_the_rest_of_the_reel_forward(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    asset = speak(scene_by_scene(settings, monkeypatch), storyboarded_run).asset

    assert asset is not None and asset.path is not None
    last = board.scenes[-1]
    assert asset.takes[-1].start_seconds == last.start_seconds
    assert loudness_at(asset.path, last.start_seconds + 0.05) > 0
    assert loudness_at(asset.path, last.start_seconds - 0.4) == 0


def test_the_measurements_describe_the_words_not_the_silence(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    asset = speak(scene_by_scene(settings, monkeypatch), storyboarded_run).asset

    assert asset is not None and asset.metrics is not None
    spoken = round(sum(take.duration_seconds for take in asset.takes), 3)
    assert asset.metrics.duration_seconds == pytest.approx(spoken, abs=0.05)
    assert asset.metrics.duration_seconds < board.total_duration_seconds / 2
    assert asset.metrics.characters_per_second > 10


def test_the_track_passes_its_own_validation(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    result = speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    asset = result.asset
    assert asset is not None
    assert asset.passed, asset.validation
    assert asset.validation is not None
    assert [check.name for check in asset.validation.failures] == []
    # It passes as a Reel-length track that is mostly silence, which is only
    # possible because the delivery is judged on the words.
    assert asset.path is not None
    assert len(asset.takes) == 8
    assert asset.metrics is not None
    assert asset.metrics.duration_seconds < parse_wav(asset.path).duration_seconds


# --- fitting each take to its own scene ---------------------------------------


def test_a_line_that_overruns_its_scene_is_refused(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 4, TOO_LONG_A_LINE)

    result = speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    assert not result.complete
    asset = result.asset
    assert asset is not None
    assert "S-05" in (asset.error or "")
    assert asset.status is AssetStatus.FAILED


def test_every_overrunning_scene_is_named(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 1, TOO_LONG_A_LINE)
    say(storyboarded_run, 4, TOO_LONG_A_LINE)

    result = speak(scene_by_scene(settings, monkeypatch), storyboarded_run)

    assert not result.complete
    asset = result.asset
    assert asset is not None
    assert asset.status is AssetStatus.FAILED
    assert "S-02" in (asset.error or "")
    assert "S-05" in (asset.error or "")
    assert "S-03" not in (asset.error or "")


def test_the_refusal_is_about_the_fit_and_not_about_the_words(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 4, A_LONG_LINE)
    assert not speak(scene_by_scene(settings, monkeypatch), storyboarded_run).complete

    # The same words, in a Reel that gives that scene more room.
    rescale(storyboarded_run, 45)

    assert speak(scene_by_scene(settings, monkeypatch), storyboarded_run).complete


def test_an_overrun_is_measured_from_the_audio_not_from_the_words(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    # Every line is short enough on paper. The recording is not.
    provider = FixedLength(seconds=4.4)

    board = read_model(storyboarded_run.storyboard_json, Storyboard)
    result = generate_voice(
        scene_by_scene(settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE),
        run_id=storyboarded_run.run_id,
        provider=provider,
    )

    assert result.complete
    asset = result.asset
    assert asset is not None
    seconds = scene_seconds(board)
    assert all(fits_its_scene(take, seconds) for take in asset.takes)
    assert all(take.speed is not None and take.speed > 1 for take in asset.takes)


def test_words_are_never_rewritten_to_make_them_fit(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    board = say(storyboarded_run, 4, TOO_LONG_A_LINE)
    before = storyboarded_run.script_json.read_bytes()
    provider = OfflineVoiceProvider()

    result = generate_voice(
        scene_by_scene(settings, monkeypatch), run_id=storyboarded_run.run_id, provider=provider
    )

    assert not result.complete
    assert result.asset is not None
    # The approved script is untouched, and the line went to the provider whole.
    assert storyboarded_run.script_json.read_bytes() == before
    assert max(call["characters"] for call in provider.calls) == len(board.scenes[4].voiceover)


def test_nothing_is_re_spoken_when_every_take_already_fits(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    provider = OfflineVoiceProvider()

    result = generate_voice(
        scene_by_scene(settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE),
        run_id=storyboarded_run.run_id,
        provider=provider,
    )

    assert result.complete
    assert result.asset is not None
    assert len(provider.calls) == 8
    assert all(take.speed is None for take in result.asset.takes)


# --- one speaking speed for the whole Reel ------------------------------------


def test_one_overrunning_line_re_speaks_the_whole_reel(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 4, A_LONG_LINE)
    provider = OfflineVoiceProvider()

    result = generate_voice(
        scene_by_scene(settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE),
        run_id=storyboarded_run.run_id,
        provider=provider,
    )

    assert result.complete
    asset = result.asset
    assert asset is not None
    speeds = {take.speed for take in asset.takes}
    assert len(speeds) == 1
    assert speeds.pop() > 1
    assert len(provider.calls) == 16


def test_the_shared_speed_is_the_slowest_that_works(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 4, A_LONG_LINE)

    result = generate_voice(
        scene_by_scene(settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE),
        run_id=storyboarded_run.run_id,
        provider=OfflineVoiceProvider(),
    )

    asset = result.asset
    assert asset is not None
    seconds = scene_seconds(read_model(storyboarded_run.storyboard_json, Storyboard))
    assert all(fits_its_scene(take, seconds) for take in asset.takes)
    tightest = max(asset.takes, key=lambda take: take.duration_seconds / seconds[take.scene_id])
    # Any slower and this one would still be running when its scene cuts.
    headroom = seconds[tightest.scene_id] - tightest.duration_seconds
    assert headroom == pytest.approx(TIMELINE_TOLERANCE_SECONDS, abs=0.06)


def test_the_change_of_pace_is_recorded(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 4, A_LONG_LINE)

    asset = generate_voice(
        scene_by_scene(settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE),
        run_id=storyboarded_run.run_id,
        provider=OfflineVoiceProvider(),
    ).asset

    assert asset is not None
    speeds = {take.speed for take in stored(storyboarded_run).takes}
    assert len(speeds) == 1
    (speed,) = speeds
    assert speed is not None and speed > 1
    assert [take.speed for take in asset.takes] == [speed] * 8


def test_a_reel_that_cannot_be_fitted_is_refused_rather_than_rushed(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 4, TOO_LONG_A_LINE)

    result = generate_voice(
        scene_by_scene(settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE),
        run_id=storyboarded_run.run_id,
        provider=OfflineVoiceProvider(),
    )

    assert not result.complete
    asset = result.asset
    assert asset is not None
    assert asset.status is AssetStatus.FAILED
    assert asset.error


def fitted(settings: Settings, run: RunContext, monkeypatch: pytest.MonkeyPatch, **window: float):
    """Re-speak the Reel at one shared speed inside the configured window.

    A bound that is not given keeps its default.
    """
    return generate_voice(
        scene_by_scene(
            settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE, **window
        ),
        run_id=run.run_id,
        provider=OfflineVoiceProvider(),
    )


def test_a_floor_above_the_needed_speed_refuses_the_reel(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 4, A_LONG_LINE)

    refused = fitted(
        settings, storyboarded_run, monkeypatch, voice_min_speed=1.5, voice_max_speed=2.0
    )
    assert not refused.complete
    assert refused.asset is not None
    assert refused.asset.status is AssetStatus.FAILED
    assert refused.asset.error

    # The same Reel, once the floor no longer stands above what it needs.
    fits = fitted(
        settings, storyboarded_run, monkeypatch, voice_min_speed=1.1, voice_max_speed=2.0
    )
    assert fits.complete
    assert fits.asset is not None
    assert all(1.1 <= (take.speed or 1.0) <= 2.0 for take in fits.asset.takes)


def test_a_ceiling_below_the_needed_speed_refuses_the_reel(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 4, A_LONG_LINE)

    refused = fitted(settings, storyboarded_run, monkeypatch, voice_max_speed=1.1)
    assert not refused.complete
    assert refused.asset is not None
    assert refused.asset.status is AssetStatus.FAILED
    assert refused.asset.error

    # Raise the ceiling and the same words fit at one speed under it.
    fits = fitted(settings, storyboarded_run, monkeypatch, voice_max_speed=1.3)
    assert fits.complete
    assert fits.asset is not None
    assert all(0.9 <= (take.speed or 1.0) <= 1.3 for take in fits.asset.takes)


def test_the_reel_keeps_one_pace_even_where_scenes_differ(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    say(storyboarded_run, 4, A_LONG_LINE)

    board = read_model(storyboarded_run.storyboard_json, Storyboard)
    asset = generate_voice(
        scene_by_scene(settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE),
        run_id=storyboarded_run.run_id,
        provider=OfflineVoiceProvider(),
    ).asset

    assert asset is not None
    seconds = scene_seconds(board)
    roomy = max(asset.takes, key=lambda take: seconds[take.scene_id] - take.duration_seconds)
    tight = min(asset.takes, key=lambda take: seconds[take.scene_id] - take.duration_seconds)
    assert seconds[roomy.scene_id] - roomy.duration_seconds > 3
    assert roomy.speed == tight.speed


# --- paying once for the same words -------------------------------------------


def test_two_scenes_saying_the_same_thing_are_spoken_once(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    say(storyboarded_run, 3, plan.beats[2].narration)
    provider = OfflineVoiceProvider()

    result = generate_voice(
        scene_by_scene(settings, monkeypatch), run_id=storyboarded_run.run_id, provider=provider
    )

    assert result.complete
    asset = result.asset
    assert asset is not None
    assert len(asset.takes) == 8
    assert len(provider.calls) == 7


def test_the_repeated_scene_still_gets_its_own_audio(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    say(storyboarded_run, 3, plan.beats[2].narration)

    asset = speak(scene_by_scene(settings, monkeypatch), storyboarded_run).asset

    assert asset is not None
    third, fourth = asset.takes[2], asset.takes[3]
    assert fourth.duration_seconds == third.duration_seconds
    assert fourth.start_seconds > third.start_seconds
    assert asset.path is not None
    assert loudness_at(asset.path, fourth.start_seconds + 0.05) > 0


def test_regenerating_the_run_still_pays_once_for_repeated_words(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    say(storyboarded_run, 3, plan.beats[2].narration)
    provider = OfflineVoiceProvider()

    result = generate_voice(
        scene_by_scene(settings, monkeypatch),
        run_id=storyboarded_run.run_id,
        provider=provider,
        force=True,
    )

    assert result.complete
    assert len(provider.calls) == 7


def test_a_repeat_at_a_new_pace_is_still_one_call(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    say(storyboarded_run, 3, plan.beats[2].narration)
    say(storyboarded_run, 4, A_LONG_LINE)
    provider = OfflineVoiceProvider()

    result = generate_voice(
        scene_by_scene(settings, monkeypatch, voice_fit_strategy=VoiceFitStrategy.REGENERATE),
        run_id=storyboarded_run.run_id,
        provider=provider,
    )

    assert result.complete
    assert len(provider.calls) == 14


# --- reusing what is already there --------------------------------------------


def test_a_finished_track_is_not_spoken_again(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    speak(scene_by_scene(settings, monkeypatch), storyboarded_run)
    provider = OfflineVoiceProvider()

    result = generate_voice(
        scene_by_scene(settings, monkeypatch), run_id=storyboarded_run.run_id, provider=provider
    )

    assert result.complete
    assert not provider.calls
    assert result.asset is not None
    assert len(result.asset.takes) == 8


def test_a_rescaled_reel_is_laid_down_again(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    first = speak(scene_by_scene(settings, monkeypatch), storyboarded_run).asset
    assert first is not None and first.path is not None
    assert parse_wav(first.path).duration_seconds == pytest.approx(40.0, abs=0.01)

    board = rescale(storyboarded_run, 30)
    result = generate_voice(
        scene_by_scene(settings, monkeypatch),
        run_id=storyboarded_run.run_id,
        provider=OfflineVoiceProvider(),
    )

    asset = result.asset
    assert asset is not None and asset.path is not None
    assert [take.start_seconds for take in asset.takes] == [
        scene.start_seconds for scene in board.scenes
    ]
    assert parse_wav(asset.path).duration_seconds == pytest.approx(30.0, abs=0.01)


def test_the_words_are_not_paid_for_twice_after_a_rescale(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    speak(scene_by_scene(settings, monkeypatch), storyboarded_run)
    rescale(storyboarded_run, 35)
    provider = OfflineVoiceProvider()

    board = read_model(storyboarded_run.storyboard_json, Storyboard)
    result = generate_voice(
        scene_by_scene(settings, monkeypatch), run_id=storyboarded_run.run_id, provider=provider
    )

    assert result.complete
    assert not provider.calls
    asset = result.asset
    assert asset is not None
    assert [take.start_seconds for take in asset.takes] == [
        scene.start_seconds for scene in board.scenes
    ]
