"""Tests for select, first, paths, values and the pattern semantics."""

from __future__ import annotations

import pytest

from configlayer.exceptions import ConfigError

CFG = {
    "db": {
        "host": "db.internal",
        "port": 5432,
        "password": "pw-db",
        "pool": {"size": 10, "password": "pw-pool"},
    },
    "auth": {"token": "tok", "user": "svc"},
    "name": "orders",
    "replicas": ["r1", "r2"],
}


# ---------------------------------------------------------------------------
# select
# ---------------------------------------------------------------------------

class TestSelect:
    def test_literal_pattern_selects_one_leaf(self):
        from configlayer.query import select

        found = select(CFG, "db.host")
        assert len(found) == 1
        assert found[0].path == "db.host"
        assert found[0].value == "db.internal"

    def test_single_star_matches_exactly_one_segment(self):
        from configlayer.query import select

        found = select(CFG, "db.*")
        assert [m.path for m in found] == [
            "db.host", "db.port", "db.password", "db.pool",
        ]

    def test_matched_interior_mapping_is_reported_whole(self):
        from configlayer.query import select

        found = select(CFG, "db.pool")
        assert found[0].value == {"size": 10, "password": "pw-pool"}

    def test_double_star_matches_across_depths(self):
        from configlayer.query import select

        found = select(CFG, "**.password")
        assert [m.path for m in found] == ["db.password", "db.pool.password"]

    def test_outermost_match_suppresses_inner_ones(self):
        from configlayer.query import select

        # db.** also covers db itself (** may match nothing), so only
        # the outermost node is reported.
        found = select(CFG, "db.**")
        assert [m.path for m in found] == ["db"]

    def test_document_order_is_preserved(self):
        from configlayer.query import select

        found = select(CFG, ["auth.user", "db.host", "name"])
        assert [m.path for m in found] == ["db.host", "auth.user", "name"]

    def test_lists_are_leaves(self):
        from configlayer.query import select

        found = select(CFG, "replicas")
        assert found[0].value == ["r1", "r2"]

    def test_multiple_patterns_do_not_duplicate_nodes(self):
        from configlayer.query import select

        found = select(CFG, ["db.host", "db.*"])
        assert [m.path for m in found] == [
            "db.host", "db.port", "db.password", "db.pool",
        ]

    def test_no_matches_is_an_empty_list(self):
        from configlayer.query import select

        assert select(CFG, "cache.*") == []

    def test_match_records_are_immutable(self):
        from configlayer.query import select

        match = select(CFG, "name")[0]
        with pytest.raises(AttributeError):
            match.value = "other"

    def test_invalid_pattern_rejected(self):
        from configlayer.query import select

        with pytest.raises(ConfigError):
            select(CFG, "db.ho*st")
        with pytest.raises(ConfigError):
            select(CFG, "")

    def test_non_mapping_config_rejected(self):
        from configlayer.query import select

        with pytest.raises(ConfigError):
            select(["a"], "x")


# ---------------------------------------------------------------------------
# first / paths / values
# ---------------------------------------------------------------------------

class TestConveniences:
    def test_first_returns_document_order_winner(self):
        from configlayer.query import first

        assert first(CFG, "**.password") == "pw-db"

    def test_first_default_when_nothing_matches(self):
        from configlayer.query import first

        assert first(CFG, "cache.*") is None
        assert first(CFG, "cache.*", default=8) == 8

    def test_paths(self):
        from configlayer.query import paths

        assert paths(CFG, "auth.*") == ["auth.token", "auth.user"]

    def test_values(self):
        from configlayer.query import values

        assert values(CFG, "**.password") == ["pw-db", "pw-pool"]
