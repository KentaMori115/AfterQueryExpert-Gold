"""End-to-end scenarios: exported text flowing back into configlayer."""

from __future__ import annotations

import json
from pathlib import Path


def parse_dotenv_lines(text: str) -> dict[str, str]:
    """Read KEY=VALUE lines the way the dotenv reader does, for feeding
    the pairs into other configlayer entry points."""
    pairs: dict[str, str] = {}
    for line in text.splitlines():
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        pairs[key.strip()] = value
    return pairs


class TestDotenvIsTheInverseOfEnvParsing:
    def test_export_then_parse_env_recovers_the_tree(self):
        from configlayer.env import parse_env
        from configlayer.export import export_dotenv

        data = {
            "db": {"host": "db.internal", "port": 5432, "tls": True},
            "app": {"name": "orders", "workers": 8},
        }
        text = export_dotenv(data, prefix="app")
        pairs = parse_dotenv_lines(text)
        recovered = parse_env(pairs, prefix="APP_")
        assert recovered == {
            "db": {"host": "db.internal", "port": 5432, "tls": True},
            "app": {"name": "orders", "workers": 8},
        }

    def test_export_without_prefix_round_trips_too(self):
        from configlayer.env import parse_env
        from configlayer.export import export_dotenv

        data = {"cache": {"ttl": 300, "backend": "memory"}}
        pairs = parse_dotenv_lines(export_dotenv(data))
        assert parse_env(pairs) == data


class TestExportedFilesAsLayers:
    def test_exported_json_becomes_a_file_source_layer(self, tmp_path: Path):
        from configlayer import LayeredConfig
        from configlayer.export import export_config
        from configlayer.source import DictSource, FileSource

        snapshot = {"db": {"host": "prod-db", "port": 5432}}
        out = tmp_path / "snapshot.json"
        out.write_text(export_config(snapshot, "json"), encoding="utf-8")

        cfg = LayeredConfig([
            DictSource({"db": {"host": "localhost", "pool": 4}},
                       name="defaults"),
            FileSource(str(out), priority=10),
        ])
        assert cfg["db.host"] == "prod-db"
        assert cfg["db.pool"] == 4
        assert cfg.origin("db.host") == "snapshot.json"

    def test_exported_ini_reloads_through_load_file_like(self):
        from configlayer.export import export_ini
        from configlayer.loader import load_file_like

        data = {"server": {"bind": "0.0.0.0", "port": 8080, "tls": False}}
        parsed = load_file_like("server.ini", export_ini(data))
        assert parsed == data

    def test_redacted_snapshot_is_safe_to_write(self, tmp_path: Path):
        from configlayer.export import export_config

        secret = "swordfish"
        text = export_config(
            {"db": {"host": "h", "password": secret},
             "auth": {"token": secret}},
            "json",
            redact_secrets=True,
        )
        assert secret not in text
        parsed = json.loads(text)
        assert parsed["db"]["password"] == "***"
        assert parsed["auth"]["token"] == "***"
        assert parsed["db"]["host"] == "h"


class TestDeterministicSnapshots:
    def test_all_three_formats_are_stable_across_key_order(self):
        from configlayer.export import export_config

        a = {"db": {"host": "h", "port": 1}, "app": {"x": 1}}
        b = {"app": {"x": 1}, "db": {"port": 1, "host": "h"}}
        for fmt in ("json", "dotenv", "ini"):
            assert export_config(a, fmt) == export_config(b, fmt), fmt

    def test_merged_layers_export_identically_to_their_resolution(self):
        from configlayer import LayeredConfig
        from configlayer.export import export_config
        from configlayer.source import DictSource

        cfg = LayeredConfig([
            DictSource({"db": {"host": "localhost", "port": 5432}},
                       name="defaults"),
            DictSource({"db": {"host": "prod"}}, name="prod", priority=10),
        ])
        text = export_config(cfg.as_dict(), "dotenv")
        assert text == "DB__HOST=prod\nDB__PORT=5432\n"


class TestExportPath:
    def test_format_picked_from_extension(self, tmp_path: Path):
        from configlayer.export import export_config, export_path

        data = {"db": {"host": "h", "port": 5432}}
        for name, fmt in (("c.json", "json"), ("c.env", "dotenv"),
                          ("c.ini", "ini")):
            out = tmp_path / name
            returned = export_path(data, str(out))
            assert out.read_text(encoding="utf-8") == returned
            assert returned == export_config(data, fmt)

    def test_explicit_format_overrides_extension(self, tmp_path: Path):
        from configlayer.export import export_config, export_path

        out = tmp_path / "snapshot.txt"
        returned = export_path({"a": {"b": 1}}, str(out), format="ini")
        assert returned == export_config({"a": {"b": 1}}, "ini")

    def test_unknown_extension_without_format_refused(self, tmp_path: Path):
        import pytest

        from configlayer.exceptions import ConfigError
        from configlayer.export import export_path

        with pytest.raises(ConfigError, match="format"):
            export_path({"a": {"b": 1}}, str(tmp_path / "c.yaml"))

    def test_redaction_and_prefix_are_forwarded(self, tmp_path: Path):
        from configlayer.export import export_path

        out = tmp_path / "app.env"
        text = export_path(
            {"db": {"password": "pw"}}, str(out),
            redact_secrets=True, prefix="app",
        )
        assert text == "APP_DB__PASSWORD=***\n"
