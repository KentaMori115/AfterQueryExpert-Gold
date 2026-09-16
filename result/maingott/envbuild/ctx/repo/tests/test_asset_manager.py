"""The generate-assets stage.

Everything runs offline: the video provider writes placeholder clips, so
generation, caching, resume and failure handling are all exercised without a
key, a network or a paid call.
"""

from __future__ import annotations

from pathlib import Path
from typing import Never

import pytest

from maingott_reel.assets.cache import AssetCache
from maingott_reel.assets.manager import (
    AssetsResult,
    build_video_provider,
    generate_assets,
    video_capabilities,
    video_provider_identity,
)
from maingott_reel.assets.probe import ContainerProbe
from maingott_reel.config import Settings
from maingott_reel.errors import (
    ConfigurationError,
    RunNotFoundError,
    StageNotCompletedError,
)
from maingott_reel.models import (
    AssetCollection,
    AssetStatus,
    AssetType,
    DurationStrategy,
    FactRegistry,
    RunManifest,
    ScriptPlan,
    StageName,
    Storyboard,
)
from maingott_reel.providers.base import VideoCapabilities
from maingott_reel.providers.fake import (
    OfflineVideoProvider,
    permanent_failure,
    transient_failure,
)
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import read_model, write_json, write_model
from maingott_reel.utils.run_context import RunContext, create_run


@pytest.fixture
def cache(tmp_path: Path) -> AssetCache:
    return AssetCache(tmp_path / "asset-cache")


def _run_stage(
    settings: Settings, run: RunContext, cache: AssetCache, **kwargs: object
) -> AssetsResult:
    """Run the stage offline with an isolated cache."""
    kwargs.setdefault("provider", OfflineVideoProvider())
    return generate_assets(
        settings,
        run_id=run.run_id,
        probe=ContainerProbe(),
        cache=cache,
        **kwargs,  # type: ignore[arg-type]
    )


UNIQUE_PROMPT = (
    "A single slow drift across a dark empty stage while one thin line of cold light "
    "settles into the centre of frame, cinematic haze, restrained and quiet mood."
)


def _isolate_first_scene(run: RunContext, board: Storyboard) -> str:
    """Give scene one a prompt no other scene shares, and return a marker for it.

    The offline shot provider writes the same house prompt for every factual
    beat, which is realistic but makes per-scene failures indistinguishable.
    """
    payload = board.model_dump(mode="json")
    payload["scenes"][0]["video_prompt"] = UNIQUE_PROMPT
    payload["scenes"][0]["asset_requirements"][0]["prompt"] = UNIQUE_PROMPT
    write_json(run.storyboard_json, payload)
    return UNIQUE_PROMPT[:40]


# --- planning and dry run -------------------------------------------------


def test_dry_run_plans_every_scene_without_generating(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    provider = OfflineVideoProvider()
    result = _run_stage(settings, storyboarded_run, cache, dry_run=True, provider=provider)

    assert result.dry_run is True
    assert result.collection is None
    assert len(result.plan.planned) == storyboard_fixture.scene_count
    assert len(result.plan.to_generate) == storyboard_fixture.scene_count
    assert provider.calls == [], "a dry run must not call the provider"
    assert not storyboarded_run.assets_json.exists()


def test_dry_run_needs_no_credentials(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    result = generate_assets(
        settings, run_id=storyboarded_run.run_id, dry_run=True, cache=cache, probe=ContainerProbe()
    )
    assert result.plan.provider == "openai"
    assert result.plan.model == settings.openai_video_model
    assert result.collection is None


def test_clip_lengths_are_rounded_up_to_what_the_provider_supports(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    result = _run_stage(settings, storyboarded_run, cache, dry_run=True)
    assert result.plan.planned
    for item in result.plan.planned:
        request = item.request
        assert request.generated_seconds in result.plan.capabilities.supported_seconds
        assert request.generated_seconds >= request.requested_duration_seconds
        exact = request.generated_seconds == request.requested_duration_seconds
        expected = DurationStrategy.EXACT if exact else DurationStrategy.TRIM_IN_POST
        assert request.duration_strategy is expected
    assert any(
        item.request.duration_strategy is DurationStrategy.TRIM_IN_POST
        for item in result.plan.planned
    ), "the storyboard's scene lengths do not divide into the provider's clip lengths"


def test_the_portrait_size_is_chosen(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    result = _run_stage(settings, storyboarded_run, cache, dry_run=True)
    for item in result.plan.planned:
        assert item.request.size == (720, 1280)


# --- generation ------------------------------------------------------------


def test_every_scene_gets_a_validated_file(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    result = _run_stage(settings, storyboarded_run, cache)

    assert result.complete
    assert result.collection is not None
    assert len(result.collection.assets) == storyboard_fixture.scene_count
    for asset in result.collection.assets:
        assert asset.is_usable
        assert asset.path is not None and asset.path.is_file()
        assert asset.sha256
        assert asset.validation is not None and asset.validation.passed
        assert asset.actual_width == 720
        assert asset.actual_height == 1280


def test_assets_are_written_where_the_run_expects_them(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    result = _run_stage(settings, storyboarded_run, cache)

    assert storyboarded_run.assets_json.is_file()
    scene_dir = storyboarded_run.assets_dir / "scene_01"
    assert (scene_dir / "video.mp4").is_file()
    assert (scene_dir / "metadata.json").is_file()
    assert read_model(storyboarded_run.assets_json, AssetCollection) == result.collection


def test_assets_are_traceable_to_the_storyboard(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    result = _run_stage(settings, storyboarded_run, cache)
    collection = result.collection
    assert collection is not None

    assert collection.narration_sha256 == storyboard_fixture.narration_sha256
    assert collection.source_sha256 == storyboard_fixture.provenance.source_sha256
    assert len(collection.storyboard_sha256) == 64
    for scene in storyboard_fixture.scenes:
        asset = collection.for_scene(scene.id)
        assert asset is not None
        assert asset.beat_id == scene.beat_id
        assert asset.prompt == scene.video_prompt
        assert asset.prompt_hash
        assert asset.requested_duration_seconds == scene.duration_seconds


def test_the_manifest_records_the_generation(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    _run_stage(settings, storyboarded_run, cache)
    manifest = read_model(storyboarded_run.manifest_json, RunManifest)

    assert manifest.stage_completed(StageName.GENERATE_ASSETS)
    assert manifest.models.video == "offline-video"
    assert "assets" in manifest.files


def test_identical_prompts_share_one_generation(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    provider = OfflineVideoProvider()
    result = _run_stage(settings, storyboarded_run, cache, provider=provider)
    collection = result.collection
    assert collection is not None

    distinct_keys = {asset.cache_key for asset in collection.assets}
    assert len(provider.calls) == len(distinct_keys)
    assert collection.cache_hits == len(collection.assets) - len(distinct_keys)


# --- cache and resume -------------------------------------------------------


def test_a_second_run_reuses_everything(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    _run_stage(settings, storyboarded_run, cache)
    provider = OfflineVideoProvider()

    second = _run_stage(settings, storyboarded_run, cache, provider=provider)

    assert provider.calls == []
    assert second.complete
    assert len(second.plan.reused) == len(second.plan.planned)


def test_a_fresh_run_is_served_from_the_shared_cache(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    registry: FactRegistry,
    script_plan: ScriptPlan,
    storyboard_fixture: Storyboard,
):
    _run_stage(settings, storyboarded_run, cache)

    other = create_run(settings, run_id="run-2")
    write_model(other.facts_json, registry)
    write_model(other.script_json, script_plan)
    write_model(other.storyboard_json, storyboard_fixture)
    from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest

    manifest = load_or_create_manifest(other)
    manifest.record_stage(StageName.ANALYZE, completed_at=registry.created_at)
    save_manifest(other, manifest)

    provider = OfflineVideoProvider()
    result = _run_stage(settings, other, cache, provider=provider)

    assert provider.calls == []
    assert result.complete
    assert result.collection is not None
    assert result.collection.cache_hits == len(result.collection.assets)


def test_force_regenerates_everything(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    _run_stage(settings, storyboarded_run, cache)
    provider = OfflineVideoProvider()

    result = _run_stage(settings, storyboarded_run, cache, provider=provider, force=True)

    assert provider.calls, "force must ignore both the run's results and the cache"
    assert result.complete


def test_a_deleted_file_is_regenerated(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    first = _run_stage(settings, storyboarded_run, cache)
    assert first.collection is not None
    missing = first.collection.assets[0]
    assert missing.path is not None
    missing.path.unlink()
    cache.discard(str(missing.cache_key))

    provider = OfflineVideoProvider()
    second = _run_stage(settings, storyboarded_run, cache, provider=provider)

    assert provider.calls, "a missing file must be generated again"
    assert second.complete


def test_a_tampered_file_is_regenerated(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    first = _run_stage(settings, storyboarded_run, cache)
    assert first.collection is not None
    asset = first.collection.assets[0]
    assert asset.path is not None
    asset.path.write_bytes(asset.path.read_bytes() + b"extra")
    cache.discard(str(asset.cache_key))

    provider = OfflineVideoProvider()
    second = _run_stage(settings, storyboarded_run, cache, provider=provider)

    assert provider.calls
    assert second.complete


# --- failures ---------------------------------------------------------------


def test_a_permanent_failure_marks_only_that_scene(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    marker = _isolate_first_scene(storyboarded_run, storyboard_fixture)
    provider = OfflineVideoProvider(failures={marker: permanent_failure("bad prompt")})

    result = _run_stage(settings, storyboarded_run, cache, provider=provider)

    assert not result.complete
    assert result.collection is not None
    failed = result.collection.failed
    assert len(failed) == 1
    assert failed[0].scene_id == "S-01"
    assert "bad prompt" in (failed[0].error or "")
    assert len(result.collection.ready) == len(result.collection.assets) - 1


def test_a_transient_failure_is_retried(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    marker = _isolate_first_scene(storyboarded_run, storyboard_fixture)
    provider = OfflineVideoProvider(failures={marker: transient_failure()})

    result = _run_stage(settings, storyboarded_run, cache, provider=provider)

    assert result.complete
    asset = result.collection.for_scene("S-01") if result.collection else None
    assert asset is not None
    assert asset.attempts == 2


def test_a_persistent_transient_failure_gives_up(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    class _AlwaysFails(OfflineVideoProvider):
        def generate_video(self, **kwargs: object) -> Never:  # type: ignore[override]
            raise transient_failure("still down")

    result = _run_stage(settings, storyboarded_run, cache, provider=_AlwaysFails())

    assert not result.complete
    assert result.collection is not None
    assert len(result.collection.failed) == len(result.collection.assets)
    assert "still down" in (result.collection.failed[0].error or "")
    assert result.collection.failed[0].attempts == settings.video_max_attempts


def test_a_corrupted_download_is_rejected(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    marker = _isolate_first_scene(storyboarded_run, storyboard_fixture)
    provider = OfflineVideoProvider(corrupt={marker})

    result = _run_stage(settings, storyboarded_run, cache, provider=provider)

    assert not result.complete
    assert result.collection is not None
    failed = result.collection.failed
    assert len(failed) == 1
    assert failed[0].scene_id == "S-01"


def test_a_failed_asset_is_retried_on_the_next_run(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    marker = _isolate_first_scene(storyboarded_run, storyboard_fixture)
    first = _run_stage(
        settings,
        storyboarded_run,
        cache,
        provider=OfflineVideoProvider(failures={marker: permanent_failure()}),
    )
    assert not first.complete

    second = _run_stage(settings, storyboarded_run, cache)

    assert second.complete, "the failed scene should be generated on the retry"


def test_keeping_failures_skips_the_retry(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    marker = _isolate_first_scene(storyboarded_run, storyboard_fixture)
    _run_stage(
        settings,
        storyboarded_run,
        cache,
        provider=OfflineVideoProvider(failures={marker: permanent_failure()}),
    )

    provider = OfflineVideoProvider()
    second = _run_stage(settings, storyboarded_run, cache, provider=provider, retry_failed=False)

    assert provider.calls == []
    assert not second.complete


def test_successful_assets_survive_a_failing_rerun(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    first = _run_stage(settings, storyboarded_run, cache)
    assert first.collection is not None
    survivor = first.collection.for_scene("S-02")
    assert survivor is not None and survivor.path is not None
    before = survivor.path.read_bytes()

    class _AlwaysFails(OfflineVideoProvider):
        def generate_video(self, **kwargs: object) -> Never:  # type: ignore[override]
            raise permanent_failure("down")

    second = _run_stage(settings, storyboarded_run, cache, provider=_AlwaysFails())

    assert second.complete, "nothing needed generating, so nothing could fail"
    assert survivor.path.read_bytes() == before


# --- capabilities and preconditions -----------------------------------------


def test_a_scene_longer_than_the_provider_supports_is_refused(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    provider = OfflineVideoProvider(
        capabilities=VideoCapabilities(
            supported_seconds=(4,), supported_sizes=((720, 1280),), max_prompt_chars=2000
        )
    )
    with pytest.raises(StageNotCompletedError, match="generates only"):
        _run_stage(settings, storyboarded_run, cache, provider=provider, dry_run=True)


def test_a_provider_without_a_portrait_size_is_refused(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    provider = OfflineVideoProvider(
        capabilities=VideoCapabilities(
            supported_seconds=(4, 8, 12), supported_sizes=((1280, 720),), max_prompt_chars=2000
        )
    )
    with pytest.raises(StageNotCompletedError, match="portrait"):
        _run_stage(settings, storyboarded_run, cache, provider=provider, dry_run=True)


def test_a_prompt_longer_than_the_provider_accepts_is_refused(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    provider = OfflineVideoProvider(
        capabilities=VideoCapabilities(
            supported_seconds=(4, 8, 12), supported_sizes=((720, 1280),), max_prompt_chars=10
        )
    )
    with pytest.raises(StageNotCompletedError, match="character prompt"):
        _run_stage(settings, storyboarded_run, cache, provider=provider, dry_run=True)


def test_an_unsupported_asset_type_is_refused(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    board = storyboard_fixture.model_dump(mode="json")
    board["scenes"][0]["asset_requirements"].append(
        {"asset_type": "music", "prompt": "calm cinematic bed", "duration_seconds": 4.0}
    )
    write_json(storyboarded_run.storyboard_json, board)

    with pytest.raises(StageNotCompletedError, match="cannot generate yet"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True)


def test_without_a_run_it_fails(settings: Settings, cache: AssetCache):
    with pytest.raises(RunNotFoundError):
        generate_assets(settings, dry_run=True, cache=cache, probe=ContainerProbe())


def test_without_a_storyboard_it_fails(
    settings: Settings, registry: FactRegistry, cache: AssetCache
):
    run = create_run(settings, run_id="bare")
    write_model(run.facts_json, registry)
    with pytest.raises(StageNotCompletedError, match="storyboard"):
        _run_stage(settings, run, cache, dry_run=True)


def test_an_unreadable_storyboard_is_reported(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    storyboarded_run.storyboard_json.write_text("{ broken", encoding="utf-8")
    with pytest.raises(StageNotCompletedError, match="unreadable"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True)


def test_a_storyboard_that_failed_validation_is_refused(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    board = storyboard_fixture.model_dump(mode="json")
    board["validation"]["checks"][0]["passed"] = False
    write_json(storyboarded_run.storyboard_json, board)
    with pytest.raises(StageNotCompletedError, match="did not pass validation"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True)


def test_a_storyboard_built_from_another_plan_is_refused(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    board = storyboard_fixture.model_dump(mode="json")
    board["narration_sha256"] = "f" * 64
    write_json(storyboarded_run.storyboard_json, board)
    with pytest.raises(StageNotCompletedError, match="different plan"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True)


def test_a_storyboard_built_from_other_facts_is_refused(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache, registry: FactRegistry
):
    write_model(
        storyboarded_run.facts_json, registry.model_copy(update={"source_sha256": "e" * 64})
    )
    with pytest.raises(StageNotCompletedError, match="different facts"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True)


def test_a_changed_source_document_is_refused(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache, tmp_path: Path
):
    source = tmp_path / "spec.docx"
    source.write_bytes(b"a different specification")
    with pytest.raises(StageNotCompletedError, match="changed since the analysis"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True, source_path=source)


def test_a_storyboard_that_no_longer_validates_is_refused(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    board = storyboard_fixture.model_dump(mode="json")
    board["scenes"][2]["voiceover"] = "Совершенно другой текст, которого не было в плане."
    write_json(storyboarded_run.storyboard_json, board)
    with pytest.raises(StageNotCompletedError, match="no longer validates"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True)


# --- provider selection ------------------------------------------------------


def test_provider_selection_is_explicit(settings: Settings):
    assert video_provider_identity(settings, offline=True) == ("fake", "offline-video")
    assert video_provider_identity(settings, offline=False) == (
        "openai",
        settings.openai_video_model,
    )


def test_capabilities_are_readable_without_credentials(settings: Settings):
    assert video_capabilities(settings, offline=False).supported_seconds == (4, 8, 12)
    assert video_capabilities(settings, offline=True).supported_seconds == (4, 8, 12)


def test_the_real_provider_needs_a_key(settings: Settings):
    assert isinstance(build_video_provider(settings, offline=True), OfflineVideoProvider)
    with pytest.raises(ConfigurationError, match="OPENAI_API_KEY"):
        build_video_provider(settings, offline=False)


def test_the_offline_provider_refuses_unsupported_requests(tmp_path: Path):
    provider = OfflineVideoProvider()
    with pytest.raises(Exception, match="cannot generate"):
        provider.generate_video(
            prompt="a dark room", seconds=7, width=720, height=1280, destination=tmp_path / "v.mp4"
        )


def test_asset_types_other_than_video_are_out_of_scope(settings: Settings):
    from maingott_reel.assets.manager import SUPPORTED_ASSET_TYPES

    assert SUPPORTED_ASSET_TYPES == (AssetType.VIDEO,)


def test_failed_assets_are_never_marked_ready(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    marker = _isolate_first_scene(storyboarded_run, storyboard_fixture)
    result = _run_stage(
        settings,
        storyboarded_run,
        cache,
        provider=OfflineVideoProvider(failures={marker: permanent_failure()}),
    )
    assert result.collection is not None
    for asset in result.collection.assets:
        if asset.status is AssetStatus.FAILED:
            assert asset.path is None
            assert asset.sha256 is None
            assert asset.error


def test_a_plan_that_failed_validation_is_refused(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    script_plan: ScriptPlan,
):
    payload = script_plan.model_dump(mode="json")
    payload["validation"]["checks"][0]["passed"] = False
    write_json(storyboarded_run.script_json, payload)
    with pytest.raises(StageNotCompletedError, match=r"plan .* did not pass validation"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True)


def test_a_plan_built_from_other_facts_is_refused(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    script_plan: ScriptPlan,
    storyboard_fixture: Storyboard,
):
    payload = script_plan.model_dump(mode="json")
    payload["provenance"]["source_sha256"] = "e" * 64
    write_json(storyboarded_run.script_json, payload)
    board = storyboard_fixture.model_dump(mode="json")
    board["provenance"]["source_sha256"] = "a" * 64
    write_json(storyboarded_run.storyboard_json, board)

    with pytest.raises(StageNotCompletedError, match=r"plan .* was built from different facts"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True)


def test_a_scene_without_a_video_requirement_is_refused(
    settings: Settings,
    storyboarded_run: RunContext,
    cache: AssetCache,
    storyboard_fixture: Storyboard,
):
    board = storyboard_fixture.model_dump(mode="json")
    board["scenes"][0]["asset_requirements"] = []
    write_json(storyboarded_run.storyboard_json, board)
    with pytest.raises(StageNotCompletedError, match="no longer validates"):
        _run_stage(settings, storyboarded_run, cache, dry_run=True)


def test_an_unreadable_assets_file_is_ignored(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    storyboarded_run.assets_json.write_text("{ broken", encoding="utf-8")
    result = _run_stage(settings, storyboarded_run, cache)
    assert result.complete


def test_a_cached_file_that_no_longer_validates_is_regenerated(
    settings: Settings, storyboarded_run: RunContext, cache: AssetCache
):
    first = _run_stage(settings, storyboarded_run, cache)
    assert first.collection is not None
    asset = first.collection.assets[0]
    assert asset.cache_key is not None

    # Truncate the cached file *and* its recorded hash, so the cache serves a
    # file that passes its own integrity check but is not usable media.
    entry = cache.lookup(asset.cache_key)
    assert entry is not None
    entry.path.write_bytes(entry.path.read_bytes()[:2048])
    write_json(
        cache.entry_dir(asset.cache_key) / "metadata.json",
        {
            "key": asset.cache_key,
            "path": str(entry.path),
            "sha256": sha256_file(entry.path),
            "request": {},
        },
    )
    storyboarded_run.assets_json.unlink()

    provider = OfflineVideoProvider()
    second = _run_stage(settings, storyboarded_run, cache, provider=provider)

    assert provider.calls, "an unusable cached file must be regenerated"
    assert second.complete


def test_build_request_needs_a_video_requirement(
    settings: Settings, storyboard_fixture: Storyboard
):
    from maingott_reel.assets.manager import build_request
    from maingott_reel.providers.fake import OFFLINE_VIDEO_CAPABILITIES

    scene = storyboard_fixture.scenes[0].model_copy(update={"asset_requirements": []})
    with pytest.raises(StageNotCompletedError, match="declares no video asset"):
        build_request(
            scene, storyboard_fixture, settings, OFFLINE_VIDEO_CAPABILITIES, "fake", "offline-video"
        )
