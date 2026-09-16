"""Tests for the compiled Query class and origin-aware selection."""

from __future__ import annotations

import pytest

from configlayer.exceptions import ConfigError

CFG = {
    "db": {"host": "h", "password": "pw", "pool": {"size": 4}},
    "auth": {"token": "tok"},
}


# ---------------------------------------------------------------------------
# Query — compile once, use many times
# ---------------------------------------------------------------------------

class TestQuery:
    def test_query_mirrors_module_functions(self):
        from configlayer.query import Query, pick, prune, select

        q = Query(["**.password", "**.token"])
        assert q.select(CFG) == select(CFG, ["**.password", "**.token"])
        assert q.pick(CFG) == pick(CFG, ["**.password", "**.token"])
        assert q.prune(CFG) == prune(CFG, ["**.password", "**.token"])

    def test_query_first_paths_values(self):
        from configlayer.query import Query

        q = Query("db.*")
        assert q.first(CFG) == "h"
        assert q.paths(CFG) == ["db.host", "db.password", "db.pool"]
        assert q.values(CFG)[0] == "h"
        assert q.first({}, default="none") == "none"

    def test_query_matches_predicate(self):
        from configlayer.query import Query

        q = Query("**.token")
        assert q.matches(CFG) is True
        assert q.matches({"db": {"host": "h"}}) is False

    def test_query_is_reusable_across_configs(self):
        from configlayer.query import Query

        q = Query("**.password")
        assert q.paths(CFG) == ["db.password"]
        assert q.paths({"root": {"password": "x"}}) == ["root.password"]
        assert q.paths({}) == []

    def test_query_from_strings_equals_query_from_key_patterns(self):
        from configlayer.policy import KeyPattern
        from configlayer.query import Query

        sample = {"a": {"k": 1}, "b": {"c": {"d": 2}}}
        from_strings = Query(["a.*", "b.**"])
        from_objects = Query([KeyPattern("a.*"), KeyPattern("b.**")])
        assert from_strings.select(sample) == from_objects.select(sample)
        assert from_strings.paths(sample) == ["a.k", "b"]

    def test_query_read_methods_reject_a_non_mapping(self):
        from configlayer.query import Query

        q = Query("db.*")
        for call in (q.select, q.first, q.paths, q.values, q.matches):
            with pytest.raises(ConfigError):
                call("not a mapping")

    def test_query_transforms_reject_a_non_mapping(self):
        from configlayer.query import Query

        q = Query("db.*")
        with pytest.raises(ConfigError):
            q.pick(None)
        with pytest.raises(ConfigError):
            q.prune(None)

    def test_query_errors_match_the_module_function_errors(self):
        from configlayer.query import Query, pick, prune, select

        q = Query("db.*")
        for bad in (None, 7, "text", ["a"]):
            for module_call, method in ((select, q.select), (pick, q.pick),
                                        (prune, q.prune)):
                with pytest.raises(ConfigError):
                    module_call(bad, "db.*")
                with pytest.raises(ConfigError):
                    method(bad)

    def test_query_accepts_precompiled_patterns(self):
        from configlayer.policy import KeyPattern
        from configlayer.query import Query

        q = Query(KeyPattern("db.*"))
        assert q.paths(CFG) == ["db.host", "db.password", "db.pool"]

    def test_query_rejects_bad_patterns_at_construction(self):
        from configlayer.query import Query

        with pytest.raises(ConfigError):
            Query("bad..pattern")
        with pytest.raises(ConfigError):
            Query([])


# ---------------------------------------------------------------------------
# select_origins — queries with provenance
# ---------------------------------------------------------------------------

def make_stack():
    from configlayer import LayeredConfig
    from configlayer.source import DictSource

    return LayeredConfig([
        DictSource(
            {"db": {"host": "localhost", "password": "dev-pw",
                    "pool": {"size": 4}}},
            name="defaults",
        ),
        DictSource(
            {"db": {"password": "prod-pw"}, "auth": {"token": "tok"}},
            name="prod",
            priority=10,
        ),
    ])


class TestSelectOrigins:
    def test_each_leaf_names_its_supplying_layer(self):
        from configlayer.query import select_origins

        found = select_origins(make_stack(), "**.password")
        assert len(found) == 1
        match = found[0]
        assert match.path == "db.password"
        assert match.value == "prod-pw"
        assert match.origin == "prod"

    def test_unshadowed_leaves_blame_the_lower_layer(self):
        from configlayer.query import select_origins

        found = select_origins(make_stack(), "db.host")
        assert found[0].origin == "defaults"
        assert found[0].value == "localhost"

    def test_interior_matches_expand_to_leaves(self):
        from configlayer.query import select_origins

        found = select_origins(make_stack(), "db")
        by_path = {m.path: m for m in found}
        assert set(by_path) == {"db.host", "db.password", "db.pool.size"}
        assert by_path["db.password"].origin == "prod"
        assert by_path["db.pool.size"].origin == "defaults"

    def test_disabling_a_layer_changes_the_reported_origin(self):
        from configlayer.query import select_origins

        stack = make_stack()
        stack.stack.disable("prod")
        found = select_origins(stack, "**.password")
        assert found[0].value == "dev-pw"
        assert found[0].origin == "defaults"

    def test_no_matches_is_an_empty_list(self):
        from configlayer.query import select_origins

        assert select_origins(make_stack(), "cache.**") == []

    def test_origin_match_records_are_immutable(self):
        from configlayer.query import select_origins

        match = select_origins(make_stack(), "db.host")[0]
        with pytest.raises(AttributeError):
            match.origin = "elsewhere"


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------

class TestSurface:
    def test_package_exports(self):
        import configlayer.query as query

        for name in ("Match", "OriginMatch", "Query", "select",
                     "select_origins", "first", "paths", "values",
                     "pick", "prune"):
            assert hasattr(query, name), name

    def test_top_level_re_exports(self):
        import configlayer
        import configlayer.query as query

        for name in ("select", "pick", "prune"):
            assert getattr(configlayer, name) is getattr(query, name), name

    def test_changelog_records_the_new_package(self):
        from pathlib import Path

        root = Path(__file__).resolve().parents[2]
        text = (root / "CHANGELOG.md").read_text(encoding="utf-8")
        newest = text.split("## [0.7.0]")[0]
        assert "query" in newest.lower()

    def test_pattern_language_is_the_policy_one(self):
        from configlayer.policy import KeyPattern
        from configlayer.query import paths

        # db.* covers db.host but not db.pool.size — exactly KeyPattern.
        assert KeyPattern("db.*").matches("db.host")
        assert not KeyPattern("db.*").matches("db.pool.size")
        assert paths(CFG, "db.*") == ["db.host", "db.password", "db.pool"]
