"""The persistent asset cache."""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.assets.cache import AssetCache
from maingott_reel.providers.placeholder_video import write_placeholder_mp4
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import write_json

KEY = "c" * 64
OTHER_KEY = "d" * 64


@pytest.fixture
def cache(tmp_path: Path) -> AssetCache:
    return AssetCache(tmp_path / "cache")


@pytest.fixture
def clip(tmp_path: Path) -> Path:
    return write_placeholder_mp4(tmp_path / "source" / "clip.mp4", 4, 720, 1280)


def test_an_unknown_key_is_a_miss(cache: AssetCache):
    assert cache.lookup(KEY) is None


def test_a_stored_asset_is_found_again(cache: AssetCache, clip: Path):
    stored = cache.store(KEY, clip, {"scene_id": "S-01"})
    found = cache.lookup(KEY)

    assert found is not None
    assert found.path == stored.path
    assert found.sha256 == sha256_file(clip)
    assert found.size_bytes == clip.stat().st_size
    assert found.metadata["scene_id"] == "S-01"


def test_the_cached_file_lives_outside_the_source(cache: AssetCache, clip: Path):
    entry = cache.store(KEY, clip, {})
    assert entry.path != clip
    assert clip.is_file(), "the original must not be moved away"
    assert cache.root in entry.path.parents


def test_different_keys_do_not_collide(cache: AssetCache, clip: Path):
    first = cache.store(KEY, clip, {})
    second = cache.store(OTHER_KEY, clip, {})
    assert first.path != second.path
    assert cache.lookup(OTHER_KEY) is not None


def test_a_deleted_file_is_a_miss(cache: AssetCache, clip: Path):
    entry = cache.store(KEY, clip, {})
    entry.path.unlink()
    assert cache.lookup(KEY) is None


def test_an_emptied_file_is_a_miss(cache: AssetCache, clip: Path):
    entry = cache.store(KEY, clip, {})
    entry.path.write_bytes(b"")
    assert cache.lookup(KEY) is None


def test_a_corrupted_file_is_a_miss(cache: AssetCache, clip: Path):
    entry = cache.store(KEY, clip, {})
    entry.path.write_bytes(b"tampered content that no longer matches the hash")
    assert cache.lookup(KEY) is None
    assert not entry.path.exists(), "a corrupted entry is dropped"


def test_unreadable_metadata_is_a_miss(cache: AssetCache, clip: Path):
    cache.store(KEY, clip, {})
    (cache.entry_dir(KEY) / "metadata.json").write_text("{ broken", encoding="utf-8")
    assert cache.lookup(KEY) is None


def test_metadata_pointing_at_nothing_is_a_miss(cache: AssetCache, tmp_path: Path):
    write_json(
        cache.entry_dir(KEY) / "metadata.json",
        {"key": KEY, "path": str(tmp_path / "gone.mp4"), "sha256": "0" * 64},
    )
    assert cache.lookup(KEY) is None


def test_storing_a_missing_file_is_refused(cache: AssetCache, tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        cache.store(KEY, tmp_path / "absent.mp4", {})


def test_storing_an_empty_file_is_refused(cache: AssetCache, tmp_path: Path):
    empty = tmp_path / "empty.mp4"
    empty.write_bytes(b"")
    with pytest.raises(ValueError, match="empty"):
        cache.store(KEY, empty, {})


def test_discard_removes_an_entry(cache: AssetCache, clip: Path):
    cache.store(KEY, clip, {})
    cache.discard(KEY)
    assert cache.lookup(KEY) is None
    cache.discard(KEY)  # discarding twice is harmless


def test_copy_into_places_a_file_in_a_run(cache: AssetCache, clip: Path, tmp_path: Path):
    entry = cache.store(KEY, clip, {})
    destination = tmp_path / "run" / "assets" / "scene_01" / "video.mp4"

    copied = cache.copy_into(entry, destination)

    assert copied == destination
    assert destination.is_file()
    assert sha256_file(destination) == entry.sha256


def test_storing_the_same_key_twice_is_idempotent(cache: AssetCache, clip: Path):
    first = cache.store(KEY, clip, {})
    second = cache.store(KEY, clip, {})
    assert first.path == second.path
    assert first.sha256 == second.sha256
