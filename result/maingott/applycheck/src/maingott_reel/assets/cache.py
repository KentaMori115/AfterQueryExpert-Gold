"""Persistent asset cache.

Video generation is the expensive part of this pipeline, so a file is
generated once and then reused for every run that asks for exactly the same
thing. The cache lives outside the run directories, keyed by the request's
content hash.

A cache entry is only served when the file is still there and still hashes to
what was recorded, so a truncated or tampered file is a miss, not a silent
corruption of the next Reel.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import orjson

from maingott_reel.logging_config import get_logger
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import read_json, write_json

logger = get_logger("assets.cache")

ASSET_FILENAME = "asset"
METADATA_FILENAME = "metadata.json"


@dataclass(frozen=True)
class CacheEntry:
    """A file the cache is holding."""

    key: str
    path: Path
    sha256: str
    size_bytes: int
    metadata: dict[str, Any]


class AssetCache:
    """Content-addressed store for generated media."""

    def __init__(self, root: Path) -> None:
        """Create a cache rooted at ``root``."""
        self._root = root

    @property
    def root(self) -> Path:
        """Directory holding the cache."""
        return self._root

    def entry_dir(self, key: str) -> Path:
        """Directory for one cache key (sharded to keep listings small)."""
        return self._root / key[:2] / key

    def path_for(self, key: str, suffix: str) -> Path:
        """Where the file for ``key`` lives."""
        return self.entry_dir(key) / f"{ASSET_FILENAME}{suffix}"

    def lookup(self, key: str) -> CacheEntry | None:
        """Return the cached entry for ``key``, or ``None`` on a miss.

        An entry whose file is missing, empty or no longer matches its
        recorded hash is treated as a miss and dropped.
        """
        metadata_path = self.entry_dir(key) / METADATA_FILENAME
        if not metadata_path.is_file():
            return None
        try:
            metadata = read_json(metadata_path)
        except (orjson.JSONDecodeError, OSError) as error:
            logger.warning("cache metadata unreadable", extra={"key": key, "error": str(error)})
            self.discard(key)
            return None

        path = Path(str(metadata.get("path", "")))
        recorded = str(metadata.get("sha256", ""))
        if not path.is_file() or path.stat().st_size == 0:
            logger.warning("cached file is missing or empty", extra={"key": key})
            self.discard(key)
            return None
        actual = sha256_file(path)
        if actual != recorded:
            logger.warning("cached file no longer matches its hash", extra={"key": key})
            self.discard(key)
            return None

        return CacheEntry(
            key=key,
            path=path,
            sha256=actual,
            size_bytes=path.stat().st_size,
            metadata=dict(metadata.get("request", {})),
        )

    def store(self, key: str, source: Path, request: dict[str, Any]) -> CacheEntry:
        """Take ``source`` into the cache under ``key``.

        Raises:
            FileNotFoundError: the file to cache does not exist.
            ValueError: the file is empty.
        """
        if not source.is_file():
            raise FileNotFoundError(f"cannot cache a file that does not exist: {source}")
        size = source.stat().st_size
        if size == 0:
            raise ValueError(f"refusing to cache an empty file: {source}")

        destination = self.path_for(key, source.suffix)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.resolve() != source.resolve():
            shutil.copy2(source, destination)
        digest = sha256_file(destination)

        write_json(
            self.entry_dir(key) / METADATA_FILENAME,
            {
                "key": key,
                "path": str(destination),
                "sha256": digest,
                "size_bytes": destination.stat().st_size,
                "stored_at": datetime.now(tz=UTC).isoformat(),
                "request": request,
            },
        )
        logger.info("asset cached", extra={"key": key, "size_bytes": size})
        return CacheEntry(
            key=key,
            path=destination,
            sha256=digest,
            size_bytes=destination.stat().st_size,
            metadata=request,
        )

    def discard(self, key: str) -> None:
        """Remove a cache entry, if it exists."""
        shutil.rmtree(self.entry_dir(key), ignore_errors=True)

    def copy_into(self, entry: CacheEntry, destination: Path) -> Path:
        """Place a cached file into a run directory.

        Raises:
            OSError: the copy failed.
        """
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(entry.path, destination)
        return destination
