import cueforge
from cueforge import compile_production, load_production, rehearse


def test_exports() -> None:
    for name in ("load_production", "compile_production", "rehearse", "DelayCue", "FailCue"):
        assert hasattr(cueforge, name)


def test_library_does_not_expose_sys_exit_helpers() -> None:
    assert not hasattr(cueforge, "main")
    assert callable(load_production)
    assert callable(compile_production)
    assert callable(rehearse)
