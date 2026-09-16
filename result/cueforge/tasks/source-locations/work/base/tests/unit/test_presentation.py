from cueforge.cli.presentation import parse_delay_option


def test_parse_delay_with_ms_suffix() -> None:
    assert parse_delay_option("auto_07=2500ms") == ("auto_07", 2500)


def test_parse_delay_without_suffix() -> None:
    assert parse_delay_option("lx_open=1000") == ("lx_open", 1000)
