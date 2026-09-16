"""Tests for pick and prune, the shape-preserving transforms."""

from __future__ import annotations

import pytest

from configlayer.exceptions import ConfigError

CFG = {
    "db": {
        "host": "db.internal",
        "password": "pw-db",
        "pool": {"size": 10, "password": "pw-pool"},
    },
    "auth": {"token": "tok", "user": "svc"},
    "name": "orders",
}

SECRETS = ["**.password", "**.token"]


class TestPick:
    def test_pick_keeps_only_matches_with_shape(self):
        from configlayer.query import pick

        assert pick(CFG, SECRETS) == {
            "db": {
                "password": "pw-db",
                "pool": {"password": "pw-pool"},
            },
            "auth": {"token": "tok"},
        }

    def test_pick_interior_match_brings_whole_subtree(self):
        from configlayer.query import pick

        assert pick(CFG, "db.pool") == {
            "db": {"pool": {"size": 10, "password": "pw-pool"}}
        }

    def test_pick_preserves_key_order(self):
        from configlayer.query import pick

        result = pick(CFG, "db.*")
        assert list(result["db"]) == ["host", "password", "pool"]

    def test_pick_nothing_returns_empty_dict(self):
        from configlayer.query import pick

        assert pick(CFG, "cache.*") == {}

    def test_pick_does_not_alias_the_input(self):
        from configlayer.query import pick

        result = pick(CFG, "db.pool")
        result["db"]["pool"]["size"] = 99
        assert CFG["db"]["pool"]["size"] == 10

    def test_pick_copies_every_nested_container(self):
        from configlayer.query import pick

        source = {"db": {"pool": {"size": 10}, "hosts": ["a", "b"]}}
        result = pick(source, "db.**")
        assert result == source
        assert result["db"] is not source["db"]
        assert result["db"]["pool"] is not source["db"]["pool"]
        assert result["db"]["hosts"] is not source["db"]["hosts"]

    def test_pick_invalid_inputs_rejected(self):
        from configlayer.query import pick

        with pytest.raises(ConfigError):
            pick("not a mapping", "x")
        with pytest.raises(ConfigError):
            pick(CFG, [])


class TestPrune:
    def test_prune_removes_matches_keeps_the_rest(self):
        from configlayer.query import prune

        assert prune(CFG, SECRETS) == {
            "db": {
                "host": "db.internal",
                "pool": {"size": 10},
            },
            "auth": {"user": "svc"},
            "name": "orders",
        }

    def test_prune_interior_match_drops_whole_subtree(self):
        from configlayer.query import prune

        result = prune(CFG, "db.pool")
        assert "pool" not in result["db"]
        assert result["db"]["host"] == "db.internal"

    def test_prune_leaves_emptied_mappings_in_place(self):
        from configlayer.query import prune

        result = prune(CFG, "auth.*")
        assert result["auth"] == {}

    def test_prune_never_mutates_the_input(self):
        from configlayer.query import prune

        prune(CFG, SECRETS)
        assert CFG["db"]["password"] == "pw-db"
        assert CFG["auth"]["token"] == "tok"

    def test_prune_result_does_not_alias_the_input(self):
        from configlayer.query import prune

        result = prune(CFG, "name")
        result["db"]["pool"]["size"] = 99
        assert CFG["db"]["pool"]["size"] == 10


    def test_prune_result_survives_later_input_mutation(self):
        from configlayer.query import prune

        source = {"db": {"host": "h", "pool": {"size": 10}, "password": "x"}}
        result = prune(source, "**.password")
        source["db"]["pool"]["size"] = 99
        source["db"]["host"] = "changed"
        assert result["db"]["pool"]["size"] == 10
        assert result["db"]["host"] == "h"

    def test_prune_copies_list_values(self):
        from configlayer.query import prune

        source = {"hosts": ["a", "b"], "password": "x"}
        result = prune(source, "password")
        result["hosts"].append("c")
        assert source["hosts"] == ["a", "b"]


class TestPickPruneComplement:
    def test_pick_and_prune_partition_the_leaves(self):
        from configlayer.query import pick, prune

        def leaves(node, prefix=""):
            out = set()
            for key, value in node.items():
                path = f"{prefix}.{key}" if prefix else key
                if isinstance(value, dict):
                    out |= leaves(value, path)
                else:
                    out.add(path)
            return out

        picked = leaves(pick(CFG, SECRETS))
        pruned = leaves(prune(CFG, SECRETS))
        assert picked | pruned == leaves(CFG)
        assert picked & pruned == set()

    def test_secret_sweep_composes_with_export_style_use(self):
        from configlayer.query import pick, prune

        safe = prune(CFG, SECRETS)
        secret = pick(CFG, SECRETS)
        assert "password" not in safe["db"]
        assert secret["db"]["password"] == "pw-db"
