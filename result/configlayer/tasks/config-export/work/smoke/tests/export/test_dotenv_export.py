"""Tests for the dotenv exporter."""

from __future__ import annotations

from pathlib import Path

import pytest

from configlayer.exceptions import ConfigError


# ---------------------------------------------------------------------------
# Key mapping
# ---------------------------------------------------------------------------

class TestDotenvKeys:
    def test_dotted_paths_become_env_names(self):
        from configlayer.export import export_dotenv

        text = export_dotenv({"db": {"host": "localhost"}})
        assert text == "DB__HOST=localhost\n"

    def test_deep_nesting_joins_with_double_underscores(self):
        from configlayer.export import export_dotenv

        text = export_dotenv({"db": {"pool": {"size": 10}}})
        assert text == "DB__POOL__SIZE=10\n"

    def test_prefix_is_prepended_with_single_underscore(self):
        from configlayer.export import export_dotenv

        text = export_dotenv({"db": {"host": "h"}}, prefix="app")
        assert text == "APP_DB__HOST=h\n"

    def test_lines_are_sorted_by_key(self):
        from configlayer.export import export_dotenv

        text = export_dotenv({"zeta": 1, "alpha": {"beta": 2, "aaa": 3}})
        assert text.splitlines() == [
            "ALPHA__AAA=3",
            "ALPHA__BETA=2",
            "ZETA=1",
        ]

    def test_unmappable_segment_rejected(self):
        from configlayer.export import export_dotenv

        with pytest.raises(ConfigError, match="db.extra-host"):
            export_dotenv({"db": {"extra-host": "x"}})
        with pytest.raises(ConfigError):
            export_dotenv({"9lives": 1})

    def test_empty_config_renders_empty_string(self):
        from configlayer.export import export_dotenv

        assert export_dotenv({}) == ""


# ---------------------------------------------------------------------------
# Value rendering and quoting
# ---------------------------------------------------------------------------

class TestDotenvValues:
    def test_scalar_rendering(self):
        from configlayer.export import export_dotenv

        text = export_dotenv({
            "flag": True, "off": False, "nothing": None,
            "count": 7, "ratio": 2.5,
        })
        assert text.splitlines() == [
            "COUNT=7",
            "FLAG=true",
            "NOTHING=",
            "OFF=false",
            "RATIO=2.5",
        ]

    def test_plain_strings_stay_bare(self):
        from configlayer.export import export_dotenv

        assert export_dotenv({"host": "db.internal"}) == "HOST=db.internal\n"

    def test_values_with_spaces_are_double_quoted(self):
        from configlayer.export import export_dotenv

        assert export_dotenv({"motto": "hello world"}) == 'MOTTO="hello world"\n'

    def test_value_with_hash_is_quoted(self):
        from configlayer.export import export_dotenv

        assert export_dotenv({"channel": "#general"}) == 'CHANNEL="#general"\n'

    def test_value_with_double_quote_uses_single_quotes(self):
        from configlayer.export import export_dotenv

        assert export_dotenv({"say": 'a "b"'}) == "SAY='a \"b\"'\n"

    def test_value_with_both_quote_kinds_rejected(self):
        from configlayer.export import export_dotenv

        with pytest.raises(ConfigError, match="say"):
            export_dotenv({"say": "it's \"both\""})

    def test_value_with_newline_rejected(self):
        from configlayer.export import export_dotenv

        with pytest.raises(ConfigError, match="banner"):
            export_dotenv({"banner": "two\nlines"})

    def test_list_of_scalars_joins_with_comma_space(self):
        from configlayer.export import export_dotenv

        text = export_dotenv({"hosts": ["a", "b", "c"]})
        assert text == 'HOSTS="a, b, c"\n'

    def test_nested_collection_inside_list_rejected(self):
        from configlayer.export import export_dotenv

        with pytest.raises(ConfigError, match=r"hosts\[1\]"):
            export_dotenv({"hosts": ["a", ["b"]]})


# ---------------------------------------------------------------------------
# Acceptance: the output reads back through the dotenv reader
# ---------------------------------------------------------------------------

class TestDotenvRoundTrip:
    def test_reads_back_through_file_source(self, tmp_path: Path):
        from configlayer.export import export_dotenv
        from configlayer.source import FileSource

        data = {
            "db": {"host": "db internal", "port": 5432, "tls": True},
            "app": {"name": "orders", "channel": "#ops"},
        }
        out = tmp_path / "app.env"
        out.write_text(export_dotenv(data), encoding="utf-8")
        parsed = FileSource(str(out)).load()
        assert parsed == {
            "APP__CHANNEL": "#ops",
            "APP__NAME": "orders",
            "DB__HOST": "db internal",
            "DB__PORT": "5432",
            "DB__TLS": "true",
        }

    def test_export_is_deterministic(self):
        from configlayer.export import export_dotenv

        a = export_dotenv({"b": 1, "a": {"y": 2, "x": 3}})
        b = export_dotenv({"a": {"x": 3, "y": 2}, "b": 1})
        assert a == b
