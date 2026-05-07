def test_signals_cli_import_smoke():
    import cli.signals_cmd as signals_cmd

    assert signals_cmd.signals_app is not None
