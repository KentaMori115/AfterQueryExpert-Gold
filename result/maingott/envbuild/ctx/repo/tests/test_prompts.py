"""Versioned prompt templates."""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.errors import ConfigurationError
from maingott_reel.utils.prompts import DEFAULT_VERSION, load_prompt

REPO_PROMPTS = Path(__file__).resolve().parents[1] / "prompts"


def _write(root: Path, name: str, text: str) -> Path:
    path = root / f"{name}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def test_front_matter_version_is_read(tmp_path: Path):
    _write(tmp_path, "system/x", "---\nversion: 7\n---\nHello {{name}}.")
    prompt = load_prompt("system/x", tmp_path)
    assert prompt.version == "7"
    assert prompt.body == "Hello {{name}}."


def test_missing_front_matter_falls_back_to_a_default_version(tmp_path: Path):
    _write(tmp_path, "plain", "Just a prompt.")
    assert load_prompt("plain", tmp_path).version == DEFAULT_VERSION


def test_render_fills_placeholders(tmp_path: Path):
    _write(tmp_path, "p", "Duration {{duration}}s in {{language}}.")
    assert load_prompt("p", tmp_path).render(duration=40, language="Russian") == (
        "Duration 40s in Russian."
    )


def test_render_rejects_missing_values(tmp_path: Path):
    _write(tmp_path, "p", "{{one}} and {{two}}")
    with pytest.raises(ConfigurationError, match="two"):
        load_prompt("p", tmp_path).render(one="1")


def test_hash_changes_with_the_body(tmp_path: Path):
    _write(tmp_path, "p", "---\nversion: 1\n---\nA")
    first = load_prompt("p", tmp_path).sha256
    _write(tmp_path, "p", "---\nversion: 1\n---\nB")
    assert load_prompt("p", tmp_path).sha256 != first


def test_missing_prompt_file_is_reported(tmp_path: Path):
    with pytest.raises(ConfigurationError, match="not found"):
        load_prompt("absent", tmp_path)


def test_empty_prompt_file_is_reported(tmp_path: Path):
    _write(tmp_path, "p", "---\nversion: 1\n---\n   ")
    with pytest.raises(ConfigurationError, match="empty"):
        load_prompt("p", tmp_path)


def test_repository_prompts_are_versioned_and_render():
    system = load_prompt("system/creative_planner", REPO_PROMPTS)
    user = load_prompt("creative/plan", REPO_PROMPTS)
    assert system.version == "1"
    assert user.version == "1"
    assert not system.placeholders
    assert user.placeholders == {
        "duration_seconds",
        "language",
        "beat_count",
        "target_policy",
        "facts",
        "feedback",
    }


def test_planner_system_prompt_states_the_hard_rules():
    body = load_prompt("system/creative_planner", REPO_PROMPTS).body.lower()
    for rule in ["fact ids", "never invent", "target", "team members", "guaranteed"]:
        assert rule in body
