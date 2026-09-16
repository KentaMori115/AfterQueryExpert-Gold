"""Tests for the INI exporter."""

from __future__ import annotations

import pytest

from configlayer.exceptions import ConfigError


class TestIniStructure:
    def test_top_level_mappings_become_sections(self):
        from configlayer.export import export_ini

        text = export_ini({"db": {"host": "localhost", "port": 5432}})
        assert text == "[db]\nhost = localhost\nport = 5432\n"

    def test_sections_and_options_are_sorted(self):
        from configlayer.export import export_ini

        text = export_ini({
            "zeta": {"b": 2, "a": 1},
            "alpha": {"k": "v"},
        })
        assert text == "[alpha]\nk = v\n\n[zeta]\na = 1\nb = 2\n"

    def test_deeper_nesting_flattens_to_dotted_options(self):
        from configlayer.export import export_ini

        text = export_ini({"db": {"pool": {"size": 10, "idle": 2}}})
        assert text == "[db]\npool.idle = 2\npool.size = 10\n"

    def test_blank_line_separates_sections(self):
        from configlayer.export import export_ini

        text = export_ini({"a": {"x": 1}, "b": {"y": 2}})
        assert "\n\n[b]\n" in text

    def test_root_scalar_rejected(self):
        from configlayer.export import export_ini

        with pytest.raises(ConfigError, match="loose"):
            export_ini({"loose": 5, "db": {"host": "h"}})

    def test_empty_config_renders_empty_string(self):
        from configlayer.export import export_ini

        assert export_ini({}) == ""


class TestIniValues:
    def test_scalars_and_lists(self):
        from configlayer.export import export_ini

        text = export_ini({"s": {
            "flag": True, "none": None, "ratio": 0.5,
            "hosts": ["a", "b"],
        }})
        assert text == (
            "[s]\nflag = true\nhosts = a, b\nnone = \nratio = 0.5\n"
        )

    def test_percent_signs_pass_through_verbatim(self):
        from configlayer.export import export_ini
        from configlayer.loader import INILoader

        # INILoader parses with interpolation disabled, so a literal
        # percent sign must not be escaped or doubled on the way out.
        text = export_ini({"app": {"rate": "50%"}})
        assert "rate = 50%" in text and "%%" not in text
        assert INILoader().load(text) == {"app": {"rate": "50%"}}

    def test_newline_in_value_rejected(self):
        from configlayer.export import export_ini

        with pytest.raises(ConfigError, match="app.motd"):
            export_ini({"app": {"motd": "a\nb"}})


class TestIniRoundTrip:
    def test_reads_back_through_ini_loader(self):
        from configlayer.export import export_ini
        from configlayer.loader import INILoader

        data = {
            "db": {"host": "localhost", "port": 5432, "tls": True},
            "app": {"rate": "50%", "workers": 8},
        }
        parsed = INILoader().load(export_ini(data))
        assert parsed == {
            "app": {"rate": "50%", "workers": 8},
            "db": {"host": "localhost", "port": 5432, "tls": True},
        }

    def test_dotted_options_survive_the_reader(self):
        from configlayer.export import export_ini
        from configlayer.loader import INILoader

        parsed = INILoader().load(export_ini({"db": {"pool": {"size": 10}}}))
        assert parsed == {"db": {"pool.size": 10}}
