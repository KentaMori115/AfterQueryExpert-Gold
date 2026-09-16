#!/usr/bin/env python3
"""Break one decision at a time and confirm the held-back suite notices.

Every mutant is a plausible wrong build of the same request, not a random
edit: each one maps to a sentence of instruction.md. A mutant that survives is
either a missing case or an equivalent mutant, and the run says which by
naming the sentence it was written for.

    python3 local/mutants.py            # every mutant
    python3 local/mutants.py per_take   # only mutants whose name matches
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASK = HERE.parent
DEV = TASK.parent.parent / "dev"
IMAGE = "maingott-env:v4"
SUITES = ["tests/test_narration_takes.py", "tests/test_take_costing.py"]

TAKES = "src/maingott_reel/audio/takes.py"
VOICE = "src/maingott_reel/audio/voice.py"
COSTING = "src/maingott_reel/costing.py"
VALIDATION = "src/maingott_reel/audio/validation.py"

#: name -> (sentence it breaks, [(file, find, replace), ...])
MUTANTS: dict[str, tuple[str, list[tuple[str, str, str]]]] = {
    "per_take_speed": (
        "re-speak every take once at one shared speaking speed",
        [
            (
                VOICE,
                """                spoken = take_stage.speak_round(
                    take_stage.at_speed(cut, speed),""",
                """                # MUTANT: each overrunning take gets its own speed, the
                # rest keep the pace they were spoken at.
                _per_take = []
                for _slot in cut:
                    _was = next(
                        t for t in spoken.takes if t.slot.scene_id == _slot.scene_id
                    )
                    _per_take.append(
                        _slot
                        if _was.fits
                        else take_stage.TakeSlot(
                            scene_id=_slot.scene_id,
                            start_seconds=_slot.start_seconds,
                            scene_seconds=_slot.scene_seconds,
                            request=_slot.request.with_speed(
                                take_stage.required_speed(_was)
                            ),
                        )
                    )
                spoken = take_stage.speak_round(
                    _per_take,""",
            )
        ],
    ),
    "speed_from_the_words": (
        "measured from audio rather than from character counts",
        [
            (
                TAKES,
                """    needed = fit_speed(take.duration_seconds, take.slot.scene_seconds)
    return round(needed * (take.slot.request.speed or 1.0), 3)""",
                """    # MUTANT: predict the delivery from the words instead of measuring it.
    predicted = take.slot.request.characters / 15.0
    needed = fit_speed(predicted, take.slot.scene_seconds)
    return round(needed * (take.slot.request.speed or 1.0), 3)""",
            ),
            (
                TAKES,
                """    @property
    def fits(self) -> bool:
        \"\"\"Whether the words can be heard inside their own scene.\"\"\"
        return self.duration_seconds <= self.slot.scene_seconds + TIMELINE_TOLERANCE_SECONDS""",
                """    @property
    def fits(self) -> bool:
        \"\"\"MUTANT: judged on the character count, not on the recording.\"\"\"
        predicted = self.slot.request.characters / 15.0
        return predicted <= self.slot.scene_seconds + TIMELINE_TOLERANCE_SECONDS""",
            ),
        ],
    ),
    "slowest_becomes_fastest": (
        "slowest speed that makes all of them fit",
        [
            (
                TAKES,
                "    return round(max((required_speed(take) for take in round_.takes), default=1.0), 3)",
                "    return round(min((required_speed(take) for take in round_.takes), default=1.0), 3)",
            )
        ],
    ),
    "fit_against_the_whole_reel": (
        "every take has to be heard inside its own scene",
        [
            (
                TAKES,
                """                request=request.for_scene(scene.id, scene.voiceover, scene.duration_seconds),""",
                """                # MUTANT: every take is measured against the whole Reel.
                request=request.for_scene(
                    scene.id, scene.voiceover, storyboard.total_duration_seconds
                ),""",
            ),
            (
                TAKES,
                """                scene_seconds=scene.duration_seconds,""",
                """                scene_seconds=storyboard.total_duration_seconds,""",
            ),
        ],
    ),
    "no_tolerance": (
        "with same tolerance timeline check already allows",
        [
            (
                TAKES,
                "        return self.duration_seconds <= self.slot.scene_seconds + TIMELINE_TOLERANCE_SECONDS",
                "        return self.duration_seconds <= self.slot.scene_seconds - 1.0",
            )
        ],
    ),
    "never_reuse_inside_a_run": (
        "identical words at same speed are generated once",
        [
            (
                TAKES,
                "        repeat = slot.request.cache_key in generated",
                "        repeat = False  # MUTANT: every scene pays for its own words",
            )
        ],
    ),
    "force_pays_twice": (
        "and `--force` does not change that",
        [
            (
                TAKES,
                "        attempt = speak(slot.request, destination(slot.scene_id), use_cache or repeat)",
                "        attempt = speak(slot.request, destination(slot.scene_id), use_cache)",
            )
        ],
    ),
    "estimate_counts_scenes": (
        "counts one call per take it would still have to generate",
        [
            (
                VOICE,
                """        if not self.takes:
            return 1
        return len({slot.request.cache_key for slot in self.takes})""",
                """        if not self.takes:
            return 1
        return len(self.takes)  # MUTANT: one call per scene, repeats included""",
            )
        ],
    ),
    "estimate_forgets_the_scene": (
        "reports one planned item per take, naming its scene",
        [
            (
                COSTING,
                "                    scene_id=slot.scene_id,",
                "                    scene_id=None,  # MUTANT",
            )
        ],
    ),
    "estimate_is_one_item": (
        "reports one planned item per take",
        [
            (
                COSTING,
                """        if cut:
            # One item per take, so a reader can see which scene is being paid
            # for; repeated words are one call, counted by the plan itself.""",
                """        if False:  # MUTANT: fall back to one item for the whole Reel""",
            )
        ],
    ),
    "takes_land_back_to_back": (
        "each starts at its scene's start instant",
        [
            (
                TAKES,
                "        blocks.append((take.slot.start_seconds, samples))",
                """        # MUTANT: lay each take straight after the one before it.
        blocks.append((round(sum(len(b) for _, b in blocks) / (rate * 2), 3), samples))""",
            )
        ],
    ),
    "track_stops_after_the_words": (
        "finished file runs exactly storyboard's total length",
        [
            (
                TAKES,
                "    return write_wav(\n        destination,\n        place_samples(blocks, total_seconds, rate, channels, depth),",
                "    return write_wav(\n        destination,\n        place_samples(blocks, round_.spoken_seconds, rate, channels, depth),",
            )
        ],
    ),
    "metrics_count_the_silence": (
        "speech metrics describe words spoken, never silence between them",
        [
            (
                VOICE,
                """    metrics = (
        speech_metrics(request, spoken.spoken_seconds, spoken.spoken_seconds) if usable else None
    )""",
                """    metrics = (
        speech_metrics(request, info.duration_seconds if info else 0.0) if usable else None
    )""",
            )
        ],
    ),
    "takes_are_not_recorded": (
        "carry `takes` beside it, one entry per spoken take in scene order",
        [
            (
                VOICE,
                "    recorded = [take.record() for take in spoken.takes if take.duration_seconds > 0]",
                "    recorded = []  # MUTANT: the track does not say how it was cut",
            )
        ],
    ),
    "the_speed_is_not_recorded": (
        "each with ... and `speed`, null where provider default was used",
        [
            (
                TAKES,
                "            speed=self.slot.request.speed,",
                "            speed=None,  # MUTANT",
            )
        ],
    ),
    "a_rescaled_reel_is_reused": (
        "rescale a storyboard and narration has to be laid down again",
        [
            (
                VOICE,
                """    if reusable and previous is not None and not _takes_still_match(previous, take_slots):""",
                """    if False and previous is not None:  # MUTANT: a rescale changes nothing""",
            )
        ],
    ),
    "the_script_hash_follows_the_last_take": (
        "`narration_sha256` is still hash of plan's narration",
        [
            (
                VOICE,
                """        narration_sha256=request.narration_sha256,
        narration_characters=request.characters,
        storyboard_sha256=request.storyboard_sha256,
        target_duration_seconds=request.target_duration_seconds,
        path=path,
        sha256=sha256_file(path) if path else None,
        size_bytes=path.stat().st_size if path else None,
        duration_seconds=info.duration_seconds if info and usable else None,
        sample_rate=info.sample_rate if info else None,
        channels=info.channels if info else None,
        codec=info.codec if info else None,
        metrics=metrics,
        attempts=1,""",
                """        narration_sha256=(
            spoken.takes[-1].slot.request.narration_sha256
            if spoken.takes
            else request.narration_sha256
        ),
        narration_characters=request.characters,
        storyboard_sha256=request.storyboard_sha256,
        target_duration_seconds=request.target_duration_seconds,
        path=path,
        sha256=sha256_file(path) if path else None,
        size_bytes=path.stat().st_size if path else None,
        duration_seconds=info.duration_seconds if info and usable else None,
        sample_rate=info.sample_rate if info else None,
        channels=info.channels if info else None,
        codec=info.codec if info else None,
        metrics=metrics,
        attempts=1,""",
            )
        ],
    ),
    "an_overrun_is_silently_accepted": (
        "should that speed fall outside the bounds, stop and say so",
        [
            (
                VOICE,
                """            else:
                spoken.error = (
                    f"the narration would have to be spoken at {speed} to fit every scene, \"""",
                """            elif False:
                spoken.error = (
                    f"the narration would have to be spoken at {speed} to fit every scene, \"""",
            ),
            (
                VOICE,
                """    if spoken.sound and spoken.overrunning:
        spoken.error = spoken.error or (""",
                """    if False:
        spoken.error = spoken.error or (""",
            ),
        ],
    ),
    "a_fail_strategy_re_speaks_anyway": (
        "when a take overruns and VOICE_FIT_STRATEGY=regenerate",
        [
            (
                VOICE,
                "        if settings.voice_fit_strategy is VoiceFitStrategy.REGENERATE:",
                "        if True:  # MUTANT: re-speak whatever the strategy says",
            )
        ],
    ),
    "scene_mode_is_ignored": (
        "add VOICE_TAKES, either whole or scene",
        [
            (
                VOICE,
                "    if settings.voice_takes is not VoiceTakes.SCENE:\n        return []",
                "    if True:  # MUTANT: always speak the Reel in one piece\n        return []",
            )
        ],
    ),
}


def run(tree: Path) -> tuple[int, int, str]:
    """Run the held-back suites in the image against one tree."""
    proc = subprocess.run(
        [
            "docker", "run", "--rm", "--network", "none", "--cpus", "2",
            "-v", f"{tree}:/app", IMAGE,
            "bash", "-lc",
            # The repo's own addopts already carry -q; adding another silences
            # the summary line this parser reads.
            "cd /app && python -m pytest -p no:cacheprovider " + " ".join(SUITES),
        ],
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    passed = sum(int(n) for n in re.findall(r"(\d+) passed", out))
    failed = sum(int(n) for n in re.findall(r"(\d+) (?:failed|error)", out))
    if not passed and not failed:
        raise SystemExit("could not read a pytest summary:\n" + out[-3000:])
    return failed, passed, out


def apply(tree: Path, edits: list[tuple[str, str, str]]) -> None:
    """Apply one mutant's edits, refusing any that does not bite."""
    for relative, find, replace in edits:
        path = tree / relative
        text = path.read_text()
        if find not in text:
            raise SystemExit(f"MUTANT EDIT DID NOT MATCH in {relative}:\n{find[:200]}")
        if find == replace:
            continue
        path.write_text(text.replace(find, replace, 1))


def main() -> None:
    wanted = sys.argv[1] if len(sys.argv) > 1 else ""
    names = [n for n in MUTANTS if wanted in n]

    control = Path(tempfile.mkdtemp(prefix="control-"))
    shutil.rmtree(control)
    shutil.copytree(DEV, control, ignore=shutil.ignore_patterns(".git", "__pycache__"))
    failed, passed, out = run(control)
    print(f"control (unmutated): {passed} passed, {failed} failed")
    if failed:
        print(out[-3000:])
        raise SystemExit("the unmutated tree does not pass; fix that before mutating")
    total = passed
    shutil.rmtree(control, ignore_errors=True)

    survivors = []
    for name in names:
        sentence, edits = MUTANTS[name]
        tree = Path(tempfile.mkdtemp(prefix=f"mutant-{name}-"))
        shutil.rmtree(tree)
        shutil.copytree(DEV, tree, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        apply(tree, edits)
        failed, passed, out = run(tree)
        caught = failed > 0
        print(
            f"{'caught ' if caught else 'SURVIVED'} {name:34s} "
            f"{failed:3d}/{total} cases fail   ({sentence})"
        )
        if not caught:
            survivors.append(name)
            print(out[-1500:])
        shutil.rmtree(tree, ignore_errors=True)

    print()
    print(f"{len(names) - len(survivors)} of {len(names)} mutants caught")
    if survivors:
        print("survivors:", ", ".join(survivors))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
