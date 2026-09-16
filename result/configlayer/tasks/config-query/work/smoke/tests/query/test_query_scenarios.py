"""Scenario tests: glob semantics on deeper trees, sweeps over stacks."""

from __future__ import annotations

DEEP = {
    "services": {
        "api": {
            "endpoint": "https://api",
            "limits": {"rps": 100, "burst": 250},
            "auth": {"password": "api-pw"},
        },
        "worker": {
            "endpoint": "amqp://worker",
            "limits": {"rps": 10},
            "auth": {"password": "worker-pw"},
        },
    },
    "region": "eu-1",
}


class TestGlobSemanticsMatrix:
    def test_star_star_star_combinations(self):
        from configlayer.query import paths

        assert paths(DEEP, "services.*.endpoint") == [
            "services.api.endpoint",
            "services.worker.endpoint",
        ]
        assert paths(DEEP, "services.*.limits.rps") == [
            "services.api.limits.rps",
            "services.worker.limits.rps",
        ]
        assert paths(DEEP, "**.password") == [
            "services.api.auth.password",
            "services.worker.auth.password",
        ]

    def test_star_never_spans_two_segments(self):
        from configlayer.query import paths

        assert paths(DEEP, "services.*.rps") == []
        assert paths(DEEP, "*.endpoint") == []

    def test_double_star_in_the_middle(self):
        from configlayer.query import paths

        assert paths(DEEP, "services.**.rps") == [
            "services.api.limits.rps",
            "services.worker.limits.rps",
        ]

    def test_trailing_double_star_selects_the_node_itself(self):
        from configlayer.query import select

        found = select(DEEP, "services.api.**")
        assert [m.path for m in found] == ["services.api"]

    def test_root_level_leaf(self):
        from configlayer.query import first

        assert first(DEEP, "region") == "eu-1"


class TestOperationalSweeps:
    def test_secret_sweep_pick_then_prune_for_handoff(self):
        from configlayer.query import pick, prune

        secret_patterns = ["**.password", "**.token", "**.secret"]
        to_vault = pick(DEEP, secret_patterns)
        to_share = prune(DEEP, secret_patterns)

        assert to_vault == {
            "services": {
                "api": {"auth": {"password": "api-pw"}},
                "worker": {"auth": {"password": "worker-pw"}},
            }
        }
        assert to_share["services"]["api"]["auth"] == {}
        assert to_share["region"] == "eu-1"

    def test_reusable_query_across_reloads(self):
        from configlayer.query import Query

        q = Query("services.*.limits.**")
        before = q.paths(DEEP)
        grown = {
            "services": {
                "api": {"limits": {"rps": 100}},
                "worker": {"limits": {"rps": 10}},
                "cron": {"limits": {"rps": 1}},
            }
        }
        after = q.paths(grown)
        assert before == [
            "services.api.limits",
            "services.worker.limits",
        ]
        assert after == [
            "services.api.limits",
            "services.worker.limits",
            "services.cron.limits",
        ]

    def test_origin_sweep_finds_the_layer_leaking_a_secret(self):
        from configlayer import LayeredConfig
        from configlayer.query import select_origins
        from configlayer.source import DictSource

        stack = LayeredConfig([
            DictSource({"api": {"key": "safe"}}, name="defaults"),
            DictSource({"api": {"password": "oops"}}, name="dev-overlay",
                       priority=5),
            DictSource({"api": {"endpoint": "https://x"}}, name="prod",
                       priority=10),
        ])
        found = select_origins(stack, "**.password")
        assert [(m.path, m.origin) for m in found] == [
            ("api.password", "dev-overlay"),
        ]

    def test_select_on_resolved_stack_equals_select_on_as_dict(self):
        from configlayer import LayeredConfig
        from configlayer.query import select, select_origins
        from configlayer.source import DictSource

        stack = LayeredConfig([
            DictSource({"db": {"host": "a", "port": 1}}, name="defaults"),
            DictSource({"db": {"host": "b"}}, name="site", priority=1),
        ])
        plain = select(stack.as_dict(), "db.*")
        origin_aware = select_origins(stack, "db.*")
        assert [m.path for m in plain] == [m.path for m in origin_aware]
        assert [m.value for m in plain] == [m.value for m in origin_aware]


class TestOrderStability:
    def test_document_order_follows_the_mapping_not_the_patterns(self):
        from configlayer.query import paths

        one = paths(DEEP, ["region", "services.api.endpoint"])
        two = paths(DEEP, ["services.api.endpoint", "region"])
        assert one == two == ["services.api.endpoint", "region"]

    def test_reordered_input_reorders_the_matches(self):
        from configlayer.query import paths

        a = {"x": {"k": 1}, "y": {"k": 2}}
        b = {"y": {"k": 2}, "x": {"k": 1}}
        assert paths(a, "**.k") == ["x.k", "y.k"]
        assert paths(b, "**.k") == ["y.k", "x.k"]


class TestRecords:
    def test_match_dataclass_shape(self):
        from configlayer.query import select

        match = select(DEEP, "region")[0]
        assert (match.path, match.value) == ("region", "eu-1")
        assert match == select(DEEP, "region")[0]
