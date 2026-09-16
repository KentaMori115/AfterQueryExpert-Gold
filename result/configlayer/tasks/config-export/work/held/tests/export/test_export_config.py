"""Tests for JSON export, the export_config dispatcher, and redaction."""

from __future__ import annotations

import json

import pytest

from configlayer.exceptions import ConfigError


# ---------------------------------------------------------------------------
# JSON exporter
# ---------------------------------------------------------------------------

class TestJsonExport:
    def test_canonical_two_space_sorted_output(self):
        from configlayer.export import export_json

        text = export_json({"b": 1, "a": {"y": [1, 2], "x": None}})
        assert text == (
            '{\n'
            '  "a": {\n'
            '    "x": null,\n'
            '    "y": [\n'
            '      1,\n'
            '      2\n'
            '    ]\n'
            '  },\n'
            '  "b": 1\n'
            '}\n'
        )

    def test_round_trips_through_json_loads(self):
        from configlayer.export import export_json

        data = {"db": {"host": "h", "port": 5432, "tls": False},
                "weights": [1, 2.5, None]}
        assert json.loads(export_json(data)) == data

    def test_trailing_newline_and_determinism(self):
        from configlayer.export import export_json

        a = export_json({"k": "v"})
        assert a.endswith("}\n")
        assert a == export_json({"k": "v"})

    def test_unrepresentable_value_rejected_with_path(self):
        from configlayer.export import export_json

        with pytest.raises(ConfigError, match="db.magic"):
            export_json({"db": {"magic": {1, 2, 3}}})

    def test_non_string_key_rejected(self):
        from configlayer.export import export_json

        with pytest.raises(ConfigError):
            export_json({"db": {5432: "port"}})


# ---------------------------------------------------------------------------
# The dispatcher
# ---------------------------------------------------------------------------

class TestExportConfig:
    def test_json_is_the_default_format(self):
        from configlayer.export import export_config, export_json

        data = {"a": 1}
        assert export_config(data) == export_json(data)

    def test_dispatch_by_name_case_insensitively(self):
        from configlayer.export import (
            export_config,
            export_dotenv,
            export_ini,
        )

        data = {"db": {"host": "h"}}
        assert export_config(data, "dotenv") == export_dotenv(data)
        assert export_config(data, "INI") == export_ini(data)

    def test_prefix_reaches_the_dotenv_renderer(self):
        from configlayer.export import export_config

        text = export_config({"db": {"host": "h"}}, "dotenv", prefix="app")
        assert text == "APP_DB__HOST=h\n"

    def test_unknown_format_rejected_and_formats_listed(self):
        from configlayer.export import export_config, export_formats

        assert export_formats() == ["dotenv", "ini", "json"]
        with pytest.raises(ConfigError, match="xml"):
            export_config({}, "xml")

    def test_non_mapping_rejected(self):
        from configlayer.export import export_config

        with pytest.raises(ConfigError):
            export_config(["not", "a", "mapping"])

    def test_export_error_is_a_config_error(self):
        from configlayer.export import ExportError

        assert issubclass(ExportError, ConfigError)


# ---------------------------------------------------------------------------
# Redaction on the way out
# ---------------------------------------------------------------------------

class TestRedactedExport:
    def test_secret_keys_are_masked_in_dotenv(self):
        from configlayer.export import export_config

        text = export_config(
            {"db": {"host": "h", "password": "hunter2"}},
            "dotenv",
            redact_secrets=True,
        )
        assert "DB__PASSWORD=***" in text
        assert "hunter2" not in text
        assert "DB__HOST=h" in text

    def test_secret_keys_are_masked_in_json(self):
        from configlayer.export import export_config

        text = export_config(
            {"auth": {"api_key": "abcd1234", "user": "ada"}},
            "json",
            redact_secrets=True,
        )
        parsed = json.loads(text)
        assert parsed["auth"]["api_key"] == "***"
        assert parsed["auth"]["user"] == "ada"

    def test_input_mapping_is_not_mutated(self):
        from configlayer.export import export_config

        data = {"db": {"token": "sekrit"}}
        export_config(data, "json", redact_secrets=True)
        assert data["db"]["token"] == "sekrit"

    def test_redaction_off_by_default(self):
        from configlayer.export import export_config

        text = export_config({"db": {"password": "pw"}}, "dotenv")
        assert "DB__PASSWORD=pw" in text


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------

class TestSurface:
    def test_top_level_re_exports(self):
        import configlayer
        from configlayer import export

        assert configlayer.export_config is export.export_config
        assert configlayer.ExportError is export.ExportError

    def test_exports_layered_config_view(self):
        from configlayer import LayeredConfig, export_config
        from configlayer.source import DictSource

        cfg = LayeredConfig([
            DictSource({"db": {"host": "localhost"}}, name="defaults"),
            DictSource({"db": {"host": "prod"}}, name="prod", priority=9),
        ])
        text = export_config(cfg.as_dict(), "dotenv")
        assert text == "DB__HOST=prod\n"


# ---------------------------------------------------------------------------
# Additional edges across the formats
# ---------------------------------------------------------------------------

class TestFormatEdges:
    def test_json_unicode_round_trips(self):
        from configlayer.export import export_json

        data = {"app": {"motto": "café ☕", "name": "orders"}}
        assert json.loads(export_json(data)) == data

    def test_dotenv_value_containing_equals_survives_the_reader(self, tmp_path):
        from configlayer.export import export_dotenv
        from configlayer.source import FileSource

        text = export_dotenv({"query": "a=b=c"})
        out = tmp_path / "q.env"
        out.write_text(text, encoding="utf-8")
        assert FileSource(str(out)).load()["QUERY"] == "a=b=c"

    def test_dotenv_numeric_list_renders_joined(self):
        from configlayer.export import export_dotenv

        assert export_dotenv({"ports": [80, 443]}) == 'PORTS="80, 443"\n'

    def test_dotenv_keys_already_upper_are_kept(self):
        from configlayer.export import export_dotenv

        assert export_dotenv({"TIMEOUT": 30}) == "TIMEOUT=30\n"

    def test_ini_single_section_has_no_blank_lines(self):
        from configlayer.export import export_ini

        text = export_ini({"only": {"k": "v"}})
        assert text == "[only]\nk = v\n"
        assert "\n\n" not in text

    def test_ini_option_value_may_contain_equals(self):
        from configlayer.export import export_ini
        from configlayer.loader import INILoader

        text = export_ini({"s": {"query": "a=b"}})
        assert INILoader().load(text) == {"s": {"query": "a=b"}}

    def test_redaction_composes_with_prefix(self):
        from configlayer.export import export_config

        text = export_config(
            {"db": {"password": "pw", "host": "h"}},
            "dotenv",
            redact_secrets=True,
            prefix="app",
        )
        assert "APP_DB__PASSWORD=***" in text
        assert "APP_DB__HOST=h" in text

    def test_export_config_leaves_layered_sources_untouched(self):
        from configlayer import LayeredConfig
        from configlayer.export import export_config
        from configlayer.source import DictSource

        cfg = LayeredConfig([
            DictSource({"auth": {"token": "sekrit"}}, name="defaults"),
        ])
        export_config(cfg.as_dict(), "json", redact_secrets=True)
        assert cfg["auth.token"] == "sekrit"
