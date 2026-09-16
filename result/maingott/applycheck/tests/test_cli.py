"""CLI shell behaviour.

The CLI must expose every documented command, and ``all`` must stop at the
first stage that fails rather than reporting success it did not achieve.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Never

import pytest
from typer.testing import CliRunner

from maingott_reel import __version__
from maingott_reel.cli import EXIT_BLOCKED, EXIT_ERROR, EXIT_OK, app
from maingott_reel.models import RunManifest, StageName
from maingott_reel.utils.jsonio import read_model

runner = CliRunner()

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def plain(output: str) -> str:
    """Strip colour codes so assertions do not depend on terminal settings."""
    return _ANSI.sub("", output)


DOCUMENTED_COMMANDS = [
    "analyze",
    "plan",
    "storyboard",
    "generate-assets",
    "generate-voice",
    "compose",
    "validate",
    "all",
]


def test_help_lists_every_documented_command():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == EXIT_OK
    for command in DOCUMENTED_COMMANDS:
        assert command in plain(result.output)


def test_version_flag():
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == EXIT_OK
    assert __version__ in plain(result.output)


def test_no_arguments_shows_help():
    result = runner.invoke(app, [])
    assert "analyze" in plain(result.output)


@pytest.mark.parametrize("command", DOCUMENTED_COMMANDS)
def test_every_documented_command_is_implemented(command: str):
    """No stage may answer with a placeholder now the pipeline is complete."""
    result = runner.invoke(app, [command, "--help"])
    assert result.exit_code == EXIT_OK
    assert "not implemented" not in plain(result.output)


def test_duration_option_is_accepted(analysed_cli_run):
    result = runner.invoke(app, ["plan", "--duration", "35", "--dry-run"])
    assert result.exit_code == EXIT_OK, plain(result.output)


@pytest.mark.parametrize("command", ["plan", "all"])
def test_duration_outside_bounds_is_rejected(command: str, analysed_cli_run):
    result = runner.invoke(app, [command, "--duration", "90"])
    assert result.exit_code == EXIT_ERROR
    assert "outside the allowed range" in plain(result.output)


def test_analyze_without_a_source_document_fails():
    result = runner.invoke(app, ["analyze"])
    assert result.exit_code == EXIT_ERROR
    assert "Source document not found" in plain(result.output)


def test_analyze_reads_a_specification_and_writes_a_run(tmp_path, sample_docx):
    result = runner.invoke(app, ["analyze", "--source", str(sample_docx)])
    assert result.exit_code == EXIT_OK, plain(result.output)
    assert "facts" in plain(result.output)

    runs = sorted((tmp_path / "output" / "runs").glob("*/facts.json"))
    assert len(runs) == 1
    assert (runs[0].parent / "logs" / "run.jsonl").is_file()


def test_analyze_reuses_an_existing_run(tmp_path, sample_docx):
    first = runner.invoke(app, ["analyze", "--source", str(sample_docx)])
    assert first.exit_code == EXIT_OK
    run_id = (tmp_path / "output" / "runs" / "LATEST").read_text().strip()

    second = runner.invoke(app, ["--run-id", run_id, "analyze", "--source", str(sample_docx)])
    assert second.exit_code == EXIT_OK
    assert "yes" in second.output


def test_all_dry_run_inspects_every_stage_without_paying(tmp_path, sample_docx, monkeypatch):
    monkeypatch.setenv("SOURCE_DOCUMENT", str(sample_docx))
    result = runner.invoke(app, ["all", "--duration", "40", "--dry-run"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "Dry run: nothing was generated" in output
    assert "compose: skipped" in output
    assert "validate: skipped" in output
    assert list((tmp_path / "output" / "runs").glob("*/facts.json"))
    assert list((tmp_path / "output" / "runs").glob("*/script.json"))
    assert list((tmp_path / "output" / "runs").glob("*/storyboard.json"))
    # Nothing that costs money, and nothing composed.
    assert not list((tmp_path / "output" / "runs").glob("*/assets.json"))
    assert not list((tmp_path / "output" / "runs").glob("*/voice.json"))
    assert not list((tmp_path / "output" / "runs").glob("*/composition.json"))


def test_all_reports_a_missing_source_document():
    result = runner.invoke(app, ["all"])
    assert result.exit_code == EXIT_ERROR
    assert "Source document not found" in plain(result.output)


def test_all_rejects_an_invalid_duration():
    result = runner.invoke(app, ["all", "--duration", "90"])
    assert result.exit_code == EXIT_ERROR
    assert "outside the allowed range" in plain(result.output)


def test_run_id_option_is_accepted():
    result = runner.invoke(app, ["--run-id", "20260819-120000", "generate-voice", "--dry-run"])
    assert result.exit_code == EXIT_ERROR
    assert "does not exist" in plain(result.output)


def test_unknown_command_fails():
    assert runner.invoke(app, ["publish"]).exit_code != EXIT_OK


def test_config_command_prints_settings_without_secrets(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-be-printed")
    result = runner.invoke(app, ["config"])
    assert result.exit_code == EXIT_OK
    assert "sk-should-not-be-printed" not in plain(result.output)
    assert "9:16" in plain(result.output)


def test_log_format_option_is_accepted():
    result = runner.invoke(app, ["--log-format", "json", "--log-level", "debug", "config"])
    assert result.exit_code == EXIT_OK


def test_invalid_log_level_is_reported_as_a_configuration_error():
    result = runner.invoke(app, ["--log-level", "LOUD", "generate-voice"])
    assert result.exit_code == EXIT_ERROR
    assert "Configuration error" in plain(result.output)


# --- plan ---------------------------------------------------------------


def test_plan_without_an_analysed_run_fails():
    result = runner.invoke(app, ["plan", "--dry-run"])
    assert result.exit_code == EXIT_ERROR
    assert "No run found" in plain(result.output)


def test_plan_writes_artifacts_and_reports(analysed_cli_run, tmp_path):
    result = runner.invoke(app, ["plan", "--duration", "40", "--dry-run"])
    assert result.exit_code == EXIT_OK, plain(result.output)

    output = plain(result.output)
    assert "validation" in output
    assert "passed" in output
    assert (analysed_cli_run / "script.json").is_file()
    assert (analysed_cli_run / "creative_brief.json").is_file()


def test_plan_updates_the_manifest(analysed_cli_run):
    runner.invoke(app, ["plan", "--dry-run"])
    manifest = read_model(analysed_cli_run / "manifest.json", RunManifest)
    assert manifest.stage_completed(StageName.PLAN)
    assert manifest.models.text == "offline-planner"


def test_plan_reuses_an_existing_plan(analysed_cli_run):
    runner.invoke(app, ["plan", "--dry-run"])
    result = runner.invoke(app, ["plan", "--dry-run"])
    assert result.exit_code == EXIT_OK
    assert "yes" in plain(result.output)


def test_plan_rejects_an_invalid_plan_with_a_non_zero_exit(analysed_cli_run, monkeypatch):
    from maingott_reel.errors import PlanRejectedError

    def _fail(*args: object, **kwargs: object) -> None:
        raise PlanRejectedError("No valid plan after 3 attempts. Last failures:\nfacts_exist")

    monkeypatch.setattr("maingott_reel.cli.run_plan", _fail)
    result = runner.invoke(app, ["plan", "--dry-run"])
    assert result.exit_code == EXIT_ERROR
    assert "facts_exist" in plain(result.output)


def test_plan_without_an_api_key_reports_configuration(analysed_cli_run, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    result = runner.invoke(app, ["plan"])
    assert result.exit_code == EXIT_ERROR
    assert "OPENAI_API_KEY" in plain(result.output)


def test_plan_accepts_a_language_option(analysed_cli_run):
    result = runner.invoke(app, ["plan", "--language", "ru", "--dry-run"])
    assert result.exit_code == EXIT_OK


def test_plan_rejects_an_unknown_language(analysed_cli_run):
    assert runner.invoke(app, ["plan", "--language", "de", "--dry-run"]).exit_code != EXIT_OK


# --- storyboard ---------------------------------------------------------


def test_storyboard_without_a_plan_fails(analysed_cli_run):
    result = runner.invoke(app, ["storyboard", "--dry-run"])
    assert result.exit_code == EXIT_ERROR
    assert "plan" in plain(result.output)


def test_storyboard_writes_scenes_and_reports(analysed_cli_run):
    assert runner.invoke(app, ["plan", "--dry-run"]).exit_code == EXIT_OK

    result = runner.invoke(app, ["storyboard", "--dry-run"])
    assert result.exit_code == EXIT_OK, plain(result.output)

    output = plain(result.output)
    assert "scenes" in output
    assert "passed" in output
    assert (analysed_cli_run / "storyboard.json").is_file()


def test_storyboard_updates_the_manifest(analysed_cli_run):
    runner.invoke(app, ["plan", "--dry-run"])
    runner.invoke(app, ["storyboard", "--dry-run"])

    manifest = read_model(analysed_cli_run / "manifest.json", RunManifest)
    assert manifest.stage_completed(StageName.STORYBOARD)
    assert "storyboard" in manifest.files


def test_storyboard_reuses_an_existing_one(analysed_cli_run):
    runner.invoke(app, ["plan", "--dry-run"])
    runner.invoke(app, ["storyboard", "--dry-run"])

    result = runner.invoke(app, ["storyboard", "--dry-run"])
    assert result.exit_code == EXIT_OK
    assert "yes" in plain(result.output)


def test_storyboard_without_an_api_key_reports_configuration(analysed_cli_run, monkeypatch):
    runner.invoke(app, ["plan", "--dry-run"])
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result = runner.invoke(app, ["storyboard"])
    assert result.exit_code == EXIT_ERROR
    assert "OPENAI_API_KEY" in plain(result.output)


def test_storyboard_rejects_an_invalid_duration(analysed_cli_run):
    runner.invoke(app, ["plan", "--dry-run"])
    result = runner.invoke(app, ["storyboard", "--duration", "90", "--dry-run"])
    assert result.exit_code == EXIT_ERROR
    assert "outside the allowed range" in plain(result.output)


# --- generate-assets -----------------------------------------------------


def _through_storyboard(monkeypatch, tmp_path: Path) -> Path:
    """Drive a run through Phase 1-3 offline and return its directory."""
    assert runner.invoke(app, ["plan", "--dry-run"]).exit_code == EXIT_OK
    assert runner.invoke(app, ["storyboard", "--dry-run"]).exit_code == EXIT_OK
    runs = tmp_path / "output" / "runs"
    return runs / (runs / "LATEST").read_text().strip()


def test_generate_assets_without_a_storyboard_fails(analysed_cli_run):
    result = runner.invoke(app, ["generate-assets", "--dry-run"])
    assert result.exit_code == EXIT_ERROR
    assert "storyboard" in plain(result.output)


def test_generate_assets_dry_run_generates_nothing(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)

    result = runner.invoke(app, ["generate-assets", "--dry-run"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "Dry run: nothing was generated" in output
    assert "GENERATE" in output
    assert not (analysed_cli_run / "assets.json").exists()
    assert not list((analysed_cli_run / "assets").glob("*/video.mp4"))


def test_generate_assets_dry_run_works_without_an_api_key(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result = runner.invoke(app, ["generate-assets", "--dry-run"])
    assert result.exit_code == EXIT_OK
    assert "openai:sora-2" in plain(result.output)


def test_generate_assets_offline_produces_files(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)

    result = runner.invoke(app, ["generate-assets", "--offline"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    assert (analysed_cli_run / "assets.json").is_file()

    from maingott_reel.models import AssetCollection, Storyboard

    board = read_model(analysed_cli_run / "storyboard.json", Storyboard)
    collection = read_model(analysed_cli_run / "assets.json", AssetCollection)
    clips = sorted((analysed_cli_run / "assets").glob("*/video.mp4"))

    assert len(clips) == board.scene_count
    assert len(collection.ready) == board.scene_count
    assert all(clip.stat().st_size > 1024 for clip in clips)


def test_generate_assets_updates_the_manifest(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])

    manifest = read_model(analysed_cli_run / "manifest.json", RunManifest)
    assert manifest.stage_completed(StageName.GENERATE_ASSETS)
    assert manifest.models.video == "offline-video"
    assert "assets" in manifest.files


def test_generate_assets_reuses_a_finished_run(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])

    result = runner.invoke(app, ["generate-assets", "--offline"])
    assert result.exit_code == EXIT_OK
    assert "to generate" in plain(result.output)


def test_generate_assets_needs_a_key_for_real_generation(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result = runner.invoke(app, ["generate-assets"])
    assert result.exit_code == EXIT_ERROR
    assert "OPENAI_API_KEY" in plain(result.output)


def test_a_failing_provider_gives_a_non_zero_exit(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)

    from maingott_reel.providers.fake import OfflineVideoProvider, permanent_failure

    class _AlwaysFails(OfflineVideoProvider):
        def generate_video(self, **kwargs: object) -> Never:  # type: ignore[override]
            raise permanent_failure("the model refused")

    monkeypatch.setattr(
        "maingott_reel.assets.manager.build_video_provider",
        lambda settings, offline: _AlwaysFails(),
    )
    result = runner.invoke(app, ["generate-assets", "--offline"])

    assert result.exit_code == EXIT_ERROR
    output = plain(result.output)
    assert "assets failed" in output
    assert "the model refused" in output


def test_all_dry_run_reaches_the_voice_stage(tmp_path, sample_docx, monkeypatch):
    monkeypatch.setenv("SOURCE_DOCUMENT", str(sample_docx))
    result = runner.invoke(app, ["all", "--duration", "40", "--dry-run"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "generate-voice" in output
    assert "narration sha256" in output
    assert list((tmp_path / "output" / "runs").glob("*/storyboard.json"))
    assert not list((tmp_path / "output" / "runs").glob("*/assets.json"))


def test_generate_assets_dry_run_labels_what_it_would_do(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])

    # The asset identity includes the provider, so the dry run has to ask
    # about the same provider to recognise what the run already holds.
    result = runner.invoke(app, ["generate-assets", "--dry-run", "--offline"])

    assert result.exit_code == EXIT_OK
    output = plain(result.output)
    assert "reuse" in output
    assert "GENERATE" not in output


def test_generate_assets_dry_run_shows_cache_hits(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])
    (analysed_cli_run / "assets.json").unlink()

    result = runner.invoke(app, ["generate-assets", "--dry-run", "--offline"])

    assert result.exit_code == EXIT_OK
    assert "cache" in plain(result.output)


def test_generate_assets_dry_run_shows_kept_failures(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)

    from maingott_reel.providers.fake import OfflineVideoProvider, permanent_failure

    class _AlwaysFails(OfflineVideoProvider):
        def generate_video(self, **kwargs: object) -> Never:  # type: ignore[override]
            raise permanent_failure("refused")

    monkeypatch.setattr(
        "maingott_reel.assets.manager.build_video_provider",
        lambda settings, offline: _AlwaysFails(),
    )
    runner.invoke(app, ["generate-assets", "--offline"])

    result = runner.invoke(app, ["generate-assets", "--dry-run", "--offline", "--keep-failed"])
    assert result.exit_code == EXIT_OK
    assert "keep failed" in plain(result.output)


def test_all_reports_failed_assets(tmp_path, sample_docx, monkeypatch):
    monkeypatch.setenv("SOURCE_DOCUMENT", str(sample_docx))
    runner.invoke(app, ["all", "--duration", "40", "--dry-run"])
    # Pin the run: a fresh one would have no plan to reuse and would reach for
    # the real planner, which needs credentials.
    run_id = (tmp_path / "output" / "runs" / "LATEST").read_text().strip()

    from maingott_reel.providers.fake import OfflineVideoProvider, permanent_failure

    class _AlwaysFails(OfflineVideoProvider):
        def generate_video(self, **kwargs: object) -> Never:  # type: ignore[override]
            raise permanent_failure("refused")

    monkeypatch.setattr(
        "maingott_reel.assets.manager.build_video_provider",
        lambda settings, offline: _AlwaysFails(),
    )
    result = runner.invoke(app, ["--run-id", run_id, "all", "--duration", "40"])

    assert result.exit_code == EXIT_ERROR
    assert "assets failed" in plain(result.output)


# --- compose --------------------------------------------------------------


def test_compose_without_a_run_fails():
    result = runner.invoke(app, ["compose", "--dry-run", "--silent-voice", "--no-logo"])
    assert result.exit_code == EXIT_ERROR
    assert "No run found" in plain(result.output)


def test_compose_without_assets_fails(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    result = runner.invoke(app, ["compose", "--dry-run", "--silent-voice", "--no-logo"])
    assert result.exit_code == EXIT_ERROR
    assert "generate-assets" in plain(result.output)


def test_compose_requires_narration_or_a_waiver(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])

    result = runner.invoke(app, ["compose", "--dry-run", "--no-logo"])
    assert result.exit_code == EXIT_ERROR
    assert "No narration" in plain(result.output)


def test_compose_requires_a_logo_or_a_waiver(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])

    result = runner.invoke(app, ["compose", "--dry-run", "--silent-voice"])
    assert result.exit_code == EXIT_ERROR
    assert "No approved logo" in plain(result.output)


def test_compose_dry_run_encodes_nothing(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])

    result = runner.invoke(app, ["compose", "--dry-run", "--silent-voice", "--no-logo"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "Dry run: nothing was encoded" in output
    assert "1080x1920" in output
    assert not (analysed_cli_run / "final" / "maingott_reel.mp4").exists()
    assert not (analysed_cli_run / "composition.json").exists()


# --- validate --------------------------------------------------------------


def test_validate_without_a_run_fails():
    result = runner.invoke(app, ["validate"])
    assert result.exit_code == EXIT_ERROR
    assert "No run found" in plain(result.output)


def test_validate_without_a_composition_fails(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])

    result = runner.invoke(app, ["validate"])
    assert result.exit_code == EXIT_ERROR
    assert "compose" in plain(result.output)


def _composed_cli_run(monkeypatch, tmp_path: Path, ffmpeg_paths: tuple[str, str]) -> Path:
    """Drive a run through Phase 1-5 offline, on a small canvas for speed."""
    monkeypatch.setenv("FFMPEG_BIN", ffmpeg_paths[0])
    monkeypatch.setenv("FFPROBE_BIN", ffmpeg_paths[1])
    monkeypatch.setenv("VIDEO_WIDTH", "270")
    monkeypatch.setenv("VIDEO_HEIGHT", "480")
    monkeypatch.setenv("VIDEO_FPS", "12")
    monkeypatch.setenv("VIDEO_PRESET", "ultrafast")
    monkeypatch.setenv("VIDEO_CRF", "35")

    run = _through_storyboard(monkeypatch, tmp_path)
    assert runner.invoke(app, ["generate-assets", "--offline"]).exit_code == EXIT_OK
    composed = runner.invoke(app, ["compose", "--silent-voice", "--no-logo"])
    assert composed.exit_code == EXIT_OK, plain(composed.output)
    return run


def test_validate_reports_the_gates(analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths):
    run = _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    result = runner.invoke(app, ["validate"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "resolution_is_correct" in output
    assert "gates passed" in output
    assert "Not production ready" in output
    assert (run / "validation.json").is_file()


def test_validate_strict_refuses_a_development_reel(
    analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths
):
    _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    result = runner.invoke(app, ["validate", "--strict"])
    assert result.exit_code == EXIT_ERROR
    assert "Not production ready" in plain(result.output)


# --- generate-voice ---------------------------------------------------------


def test_generate_voice_without_a_storyboard_fails(analysed_cli_run):
    result = runner.invoke(app, ["generate-voice", "--dry-run"])
    assert result.exit_code == EXIT_ERROR
    assert "storyboard" in plain(result.output)


def test_generate_voice_dry_run_generates_nothing(analysed_cli_run, tmp_path, monkeypatch):
    run = _through_storyboard(monkeypatch, tmp_path)

    result = runner.invoke(app, ["generate-voice", "--dry-run"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "Dry run: nothing was generated" in output
    assert "narration sha256" in output
    assert "generation calls" in output
    assert not (run / "voice.json").exists()
    assert not (run / "audio" / "voice.wav").exists()


def test_generate_voice_dry_run_works_without_an_api_key(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result = runner.invoke(app, ["generate-voice", "--dry-run"])

    assert result.exit_code == EXIT_OK
    assert "gpt-4o-mini-tts" in plain(result.output)


def test_generate_voice_needs_a_key_for_real_generation(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result = runner.invoke(app, ["generate-voice"])

    assert result.exit_code == EXIT_ERROR
    assert "OPENAI_API_KEY" in plain(result.output)


def test_generate_voice_offline_produces_a_track(analysed_cli_run, tmp_path, monkeypatch):
    run = _through_storyboard(monkeypatch, tmp_path)

    result = runner.invoke(app, ["generate-voice", "--offline"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "Development narration" in output
    assert "speech rate" in output
    assert (run / "voice.json").is_file()
    assert (run / "audio" / "voice.wav").is_file()

    manifest = read_model(run / "manifest.json", RunManifest)
    assert manifest.stage_completed(StageName.GENERATE_VOICE)
    assert manifest.files["voice"].name == "voice.json"


def test_generate_voice_reuses_an_existing_track(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    assert runner.invoke(app, ["generate-voice", "--offline"]).exit_code == EXIT_OK

    result = runner.invoke(app, ["generate-voice", "--offline"])

    assert result.exit_code == EXIT_OK
    assert "reuse" in plain(result.output)


def test_a_failing_voice_provider_gives_a_non_zero_exit(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)

    from maingott_reel.providers.fake import OfflineVoiceProvider, permanent_failure

    class _AlwaysFails(OfflineVoiceProvider):
        def synthesize(self, **kwargs: object) -> Never:  # type: ignore[override]
            raise permanent_failure("the model refused")

    monkeypatch.setattr(
        "maingott_reel.audio.voice.build_voice_provider",
        lambda settings, offline: _AlwaysFails(),
    )
    result = runner.invoke(app, ["generate-voice", "--offline"])

    assert result.exit_code == EXIT_ERROR
    output = plain(result.output)
    assert "could not be generated" in output
    assert "the model refused" in output


# --- the whole pipeline -------------------------------------------------------


def _offline_pipeline_env(monkeypatch, ffmpeg_paths: tuple[str, str]) -> None:
    """A small, fast canvas so the end-to-end run is affordable in tests."""
    monkeypatch.setenv("FFMPEG_BIN", ffmpeg_paths[0])
    monkeypatch.setenv("FFPROBE_BIN", ffmpeg_paths[1])
    monkeypatch.setenv("VIDEO_WIDTH", "270")
    monkeypatch.setenv("VIDEO_HEIGHT", "480")
    monkeypatch.setenv("VIDEO_FPS", "12")
    monkeypatch.setenv("VIDEO_PRESET", "ultrafast")
    monkeypatch.setenv("VIDEO_CRF", "35")


def test_all_offline_runs_every_stage_to_a_validated_reel(
    tmp_path, sample_docx, monkeypatch, ffmpeg_paths
):
    monkeypatch.setenv("SOURCE_DOCUMENT", str(sample_docx))
    _offline_pipeline_env(monkeypatch, ffmpeg_paths)

    result = runner.invoke(app, ["all", "--duration", "40", "--offline"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    for stage in ("analyze", "plan", "storyboard", "generate-assets", "generate-voice", "compose"):
        assert stage in output
    assert "gates passed" in output
    assert "Not production ready" in output

    runs = tmp_path / "output" / "runs"
    run = runs / (runs / "LATEST").read_text().strip()
    for artifact in (
        "facts.json",
        "script.json",
        "storyboard.json",
        "assets.json",
        "voice.json",
        "composition.json",
        "validation.json",
    ):
        assert (run / artifact).is_file(), artifact
    assert (run / "final" / "maingott_reel.mp4").is_file()

    manifest = read_model(run / "manifest.json", RunManifest)
    assert [record.stage for record in manifest.stages] == [
        StageName.ANALYZE,
        StageName.PLAN,
        StageName.STORYBOARD,
        StageName.GENERATE_ASSETS,
        StageName.GENERATE_VOICE,
        StageName.COMPOSE,
        StageName.VALIDATE,
    ]


def test_an_offline_reel_is_never_release_ready(tmp_path, sample_docx, monkeypatch, ffmpeg_paths):
    monkeypatch.setenv("SOURCE_DOCUMENT", str(sample_docx))
    _offline_pipeline_env(monkeypatch, ffmpeg_paths)
    assert runner.invoke(app, ["all", "--duration", "40", "--offline"]).exit_code == EXIT_OK

    result = runner.invoke(app, ["validate", "--strict"])

    assert result.exit_code == EXIT_ERROR
    output = plain(result.output)
    assert "Not production ready" in output
    assert "narration_is_a_production_voice" in output


def test_a_second_offline_run_reuses_everything(tmp_path, sample_docx, monkeypatch, ffmpeg_paths):
    monkeypatch.setenv("SOURCE_DOCUMENT", str(sample_docx))
    _offline_pipeline_env(monkeypatch, ffmpeg_paths)
    assert runner.invoke(app, ["all", "--duration", "40", "--offline"]).exit_code == EXIT_OK
    runs = tmp_path / "output" / "runs"
    run_id = (runs / "LATEST").read_text().strip()

    result = runner.invoke(app, ["--run-id", run_id, "all", "--duration", "40", "--offline"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "reuse" in output


def test_a_failing_voice_stage_stops_the_pipeline(tmp_path, sample_docx, monkeypatch):
    monkeypatch.setenv("SOURCE_DOCUMENT", str(sample_docx))

    from maingott_reel.providers.fake import OfflineVoiceProvider, permanent_failure

    class _AlwaysFails(OfflineVoiceProvider):
        def synthesize(self, **kwargs: object) -> Never:  # type: ignore[override]
            raise permanent_failure("the model refused")

    monkeypatch.setattr(
        "maingott_reel.audio.voice.build_voice_provider",
        lambda settings, offline: _AlwaysFails(),
    )
    result = runner.invoke(app, ["all", "--duration", "40", "--offline"])

    assert result.exit_code == EXIT_ERROR
    output = plain(result.output)
    assert "could not be generated" in output
    # Composition and validation never ran.
    assert "compose —" not in output
    assert "gates passed" not in output

    runs = tmp_path / "output" / "runs"
    run = runs / (runs / "LATEST").read_text().strip()
    assert not (run / "composition.json").exists()
    assert not (run / "validation.json").exists()


def test_a_tampered_reel_fails_the_pipeline_audit(tmp_path, sample_docx, monkeypatch, ffmpeg_paths):
    monkeypatch.setenv("SOURCE_DOCUMENT", str(sample_docx))
    _offline_pipeline_env(monkeypatch, ffmpeg_paths)
    assert runner.invoke(app, ["all", "--duration", "40", "--offline"]).exit_code == EXIT_OK

    runs = tmp_path / "output" / "runs"
    run = runs / (runs / "LATEST").read_text().strip()
    reel = run / "final" / "maingott_reel.mp4"
    reel.write_bytes(reel.read_bytes() + b"\x00")

    result = runner.invoke(app, ["validate"])

    assert result.exit_code == EXIT_ERROR
    assert "final_file_is_unchanged" in plain(result.output)


# --- cost control -----------------------------------------------------------


def test_cost_estimate_reports_unknown_pricing(analysed_cli_run, tmp_path, monkeypatch):
    run = _through_storyboard(monkeypatch, tmp_path)

    result = runner.invoke(app, ["cost-estimate"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "COST UNKNOWN" in output
    assert "paid call(s)" in output
    assert "Nothing was generated" in output
    assert (run / "generation_plan.json").is_file()


def test_cost_estimate_prices_a_configured_table(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    _write_pricing(tmp_path)

    result = runner.invoke(app, ["cost-estimate"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    output = plain(result.output)
    assert "COST UNKNOWN" not in output
    assert "USD" in output


def _write_pricing(tmp_path: Path, video: float = 0.10, voice: float = 0.015) -> Path:
    from maingott_reel.models import ModelPrice, PricingTable
    from maingott_reel.utils.jsonio import write_model

    return write_model(
        tmp_path / "input" / "pricing.json",
        PricingTable(
            source="checked by the project",
            video={"sora-2": ModelPrice(per_second_usd=video)},
            voice={"gpt-4o-mini-tts": ModelPrice(per_1k_characters_usd=voice)},
        ),
    )


def test_cost_estimate_needs_no_api_key(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    assert runner.invoke(app, ["cost-estimate"]).exit_code == EXIT_OK


def test_cost_estimate_shows_cached_work_as_free(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])
    runner.invoke(app, ["generate-voice", "--offline"])

    result = runner.invoke(app, ["cost-estimate", "--offline"])

    assert result.exit_code == EXIT_OK
    assert "0 paid calls" in plain(result.output)


def test_generation_stops_when_it_would_go_over_budget(analysed_cli_run, tmp_path, monkeypatch):
    from maingott_reel.config import reset_settings_cache

    _through_storyboard(monkeypatch, tmp_path)
    _write_pricing(tmp_path, video=10.0)
    monkeypatch.setenv("MAX_GENERATION_COST", "1.0")
    reset_settings_cache()

    from maingott_reel.assets import manager
    from maingott_reel.providers.fake import OfflineVideoProvider

    class _PaidLooking(OfflineVideoProvider):
        @property
        def name(self) -> str:
            return "openai"

        @property
        def model(self) -> str:
            return "sora-2"

    monkeypatch.setattr(manager, "build_video_provider", lambda settings, offline: _PaidLooking())

    result = runner.invoke(app, ["generate-assets"])

    assert result.exit_code == EXIT_ERROR
    assert "over the configured budget" in plain(result.output)

    override = runner.invoke(app, ["generate-assets", "--allow-over-budget"])
    assert override.exit_code == EXIT_OK, plain(override.output)


# --- release ------------------------------------------------------------------


def _write_brand_files(tmp_path: Path, logo: Path) -> None:
    from tests.conftest import write_brand_registry, write_voice_profile

    from maingott_reel.config import Settings

    settings = Settings(
        output_root=tmp_path / "output",
        input_root=tmp_path / "input",
        brand_dir=tmp_path / "input" / "brand",
    )
    write_brand_registry(settings, logo=logo)
    write_voice_profile(settings)


def test_release_check_blocks_a_development_reel(
    analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths
):
    _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    result = runner.invoke(app, ["release-check"])

    assert result.exit_code == EXIT_BLOCKED
    output = plain(result.output)
    assert "BLOCKED" in output
    assert "not_a_development_composition" in output
    assert "must not be released" in output


def test_release_check_without_a_composition_fails(analysed_cli_run, tmp_path, monkeypatch):
    _through_storyboard(monkeypatch, tmp_path)
    runner.invoke(app, ["generate-assets", "--offline"])

    result = runner.invoke(app, ["release-check"])

    assert result.exit_code == EXIT_ERROR
    assert "compose" in plain(result.output)


def test_approve_refuses_a_development_reel(analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths):
    run = _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    result = runner.invoke(app, ["approve", "--by", "Release Manager"])

    assert result.exit_code == EXIT_BLOCKED
    assert "not a release candidate" in plain(result.output)
    assert not (run / "approval.json").exists()


def test_release_refuses_a_development_reel(analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths):
    _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    result = runner.invoke(app, ["release"])

    assert result.exit_code == EXIT_BLOCKED
    assert not (tmp_path / "output" / "releases").exists()


def test_review_prints_the_checklist_and_records_confirmations(
    analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths
):
    run = _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    listed = runner.invoke(app, ["review"])
    assert listed.exit_code == EXIT_OK, plain(listed.output)
    output = plain(listed.output)
    assert "visual_quality" in output
    assert "0/13" in output
    assert "[ ]" in output

    confirmed = runner.invoke(app, ["review", "--confirm", "visual_quality", "--by", "Reviewer"])
    assert confirmed.exit_code == EXIT_OK
    assert "1/13" in plain(confirmed.output)
    assert (run / "review.json").is_file()


def test_review_refuses_a_confirmation_without_a_name(
    analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths
):
    _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    result = runner.invoke(app, ["review", "--confirm", "all"])

    assert result.exit_code == EXIT_ERROR
    assert "--by" in plain(result.output)


def test_review_refuses_an_unknown_item(analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths):
    _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    result = runner.invoke(app, ["review", "--confirm", "looks_cool", "--by", "Reviewer"])

    assert result.exit_code == EXIT_ERROR
    assert "unknown review item" in plain(result.output)


def test_release_validate_without_a_release_fails(analysed_cli_run):
    result = runner.invoke(app, ["release-validate"])
    assert result.exit_code == EXIT_ERROR
    assert "No release package" in plain(result.output)


def test_compare_reports_two_runs(analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths):
    run = _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)
    import shutil

    clone = run.parent / "clone"
    shutil.copytree(run, clone)

    result = runner.invoke(app, ["compare", run.name, "clone"])

    assert result.exit_code == EXIT_OK, plain(result.output)
    assert "identical" in plain(result.output)


def test_compare_reports_an_unknown_run(analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths):
    run = _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    result = runner.invoke(app, ["compare", run.name, "nope"])

    assert result.exit_code == EXIT_ERROR
    assert "does not exist" in plain(result.output)


def test_reproduce_check_reports_what_is_recorded(
    analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths
):
    _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)
    runner.invoke(app, ["release-check"])

    result = runner.invoke(app, ["reproduce-check"])

    output = plain(result.output)
    assert "storyboard" in output
    assert "configuration snapshot" in output


def test_no_command_publishes_anything():
    """Phase 8 ends at an approved package: nothing here reaches a platform."""
    output = plain(runner.invoke(app, ["--help"]).output)
    for forbidden in ("publish", "upload", "instagram", "schedule", "post"):
        assert forbidden not in output.lower()


def _production_cli_run(monkeypatch, tmp_path: Path, ffmpeg_paths, logo: Path) -> Path:
    """Drive a run to something that looks like a real production run.

    The footage and narration are still offline — nothing here spends money —
    but they are recorded as a real provider's work, and the brand mark and
    voice are registered as approved, so the release path can be exercised.
    """
    from tests.conftest import (
        make_production_assets,
        make_production_voice,
        write_brand_registry,
        write_voice_profile,
    )

    from maingott_reel.config import Settings

    _offline_pipeline_env(monkeypatch, ffmpeg_paths)
    run = _through_storyboard(monkeypatch, tmp_path)
    assert runner.invoke(app, ["generate-assets", "--offline"]).exit_code == EXIT_OK

    settings = Settings(
        output_root=tmp_path / "output",
        input_root=tmp_path / "input",
        brand_dir=tmp_path / "input" / "brand",
        ffmpeg_bin=ffmpeg_paths[0],
        ffprobe_bin=ffmpeg_paths[1],
    )
    write_brand_registry(settings, logo=logo)
    write_voice_profile(settings)

    from maingott_reel.utils.run_context import RunContext

    context = RunContext(run_id=run.name, root=run)
    make_production_voice(settings, context)
    make_production_assets(context)

    assert runner.invoke(app, ["compose"]).exit_code == EXIT_OK
    assert runner.invoke(app, ["validate"]).exit_code == EXIT_OK
    return run


def test_a_production_run_can_be_reviewed_approved_and_released(
    analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths, logo_file
):
    run = _production_cli_run(monkeypatch, tmp_path, ffmpeg_paths, logo_file)

    checked = runner.invoke(app, ["release-check"])
    assert checked.exit_code == EXIT_OK, plain(checked.output)
    assert "RELEASE CANDIDATE" in plain(checked.output)

    # A candidate is not an approval.
    too_soon = runner.invoke(app, ["approve", "--by", "Release Manager"])
    assert too_soon.exit_code == EXIT_ERROR
    assert "human review" in plain(too_soon.output)

    reviewed = runner.invoke(app, ["review", "--confirm", "all", "--by", "Reviewer"])
    assert reviewed.exit_code == EXIT_OK
    assert "Human review complete" in plain(reviewed.output)

    approved = runner.invoke(
        app, ["approve", "--by", "Release Manager", "--version", "v1.0.0", "--note", "Checked."]
    )
    assert approved.exit_code == EXIT_OK, plain(approved.output)
    assert "Approved" in plain(approved.output)
    assert (run / "approval.json").is_file()

    released = runner.invoke(app, ["release"])
    assert released.exit_code == EXIT_OK, plain(released.output)
    assert "Immutable release package written" in plain(released.output)

    releases = sorted((tmp_path / "output" / "releases").iterdir())
    assert len(releases) == 1
    package = releases[0]
    assert (package / "release.json").is_file()
    assert (package / "final" / "maingott_reel.mp4").is_file()
    assert (package / "metadata" / "approval.json").is_file()

    validated = runner.invoke(app, ["release-validate"])
    assert validated.exit_code == EXIT_OK, plain(validated.output)
    assert "is intact" in plain(validated.output)

    audited = runner.invoke(app, ["reproduce-check", "--release-id", package.name])
    assert audited.exit_code == EXIT_OK, plain(audited.output)


def test_a_tampered_release_package_fails_validation(
    analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths, logo_file
):
    _production_cli_run(monkeypatch, tmp_path, ffmpeg_paths, logo_file)
    runner.invoke(app, ["review", "--confirm", "all", "--by", "Reviewer"])
    runner.invoke(app, ["approve", "--by", "Release Manager"])
    assert runner.invoke(app, ["release"]).exit_code == EXIT_OK

    package = next((tmp_path / "output" / "releases").iterdir())
    reel = package / "final" / "maingott_reel.mp4"
    reel.write_bytes(reel.read_bytes() + b"\x00")

    result = runner.invoke(app, ["release-validate"])

    assert result.exit_code == EXIT_ERROR
    assert "has changed since it was written" in plain(result.output)


def test_recomposing_invalidates_an_approval(
    analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths, logo_file
):
    run = _production_cli_run(monkeypatch, tmp_path, ffmpeg_paths, logo_file)
    runner.invoke(app, ["review", "--confirm", "all", "--by", "Reviewer"])
    assert runner.invoke(app, ["approve", "--by", "Release Manager"]).exit_code == EXIT_OK

    reel = run / "final" / "maingott_reel.mp4"
    reel.write_bytes(reel.read_bytes() + b"\x00")

    result = runner.invoke(app, ["release"])

    assert result.exit_code != EXIT_OK
    assert not (tmp_path / "output" / "releases").exists()


def test_a_rejection_can_be_recorded_for_a_development_reel(
    analysed_cli_run, tmp_path, monkeypatch, ffmpeg_paths
):
    run = _composed_cli_run(monkeypatch, tmp_path, ffmpeg_paths)

    result = runner.invoke(
        app, ["approve", "--by", "Release Manager", "--reject", "--note", "Placeholder footage."]
    )

    assert result.exit_code == EXIT_OK, plain(result.output)
    assert "rejected" in plain(result.output)
    assert (run / "approval.json").is_file()
    assert runner.invoke(app, ["release"]).exit_code != EXIT_OK
