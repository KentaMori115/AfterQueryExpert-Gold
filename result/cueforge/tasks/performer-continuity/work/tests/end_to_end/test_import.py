def test_installed_package_version() -> None:
    import cueforge

    assert cueforge.__version__ == "0.1.0"
