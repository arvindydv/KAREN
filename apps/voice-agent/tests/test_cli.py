from __future__ import annotations

import importlib

import pytest

from karen_voice.cli import main


def test_modules_import_without_credentials() -> None:
    for module in (
        "karen_voice.worker",
        "karen_voice.cli",
        "karen_voice.observability",
        "karen_voice.bridge",
    ):
        importlib.import_module(module)


@pytest.mark.parametrize("command", ["dev", "start", "connect", "console"])
def test_refuses_to_connect_without_livekit_credentials(
    command: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main([command]) == 2
    err = capsys.readouterr().err
    assert "refusing to connect" in err
    assert "LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET" in err


def test_invalid_configuration_refuses_to_start(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    assert main(["start"]) == 2
    assert "INTERNAL_SERVICE_HMAC_SECRET" in capsys.readouterr().err
