"""Rendering on-screen text."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from maingott_reel.errors import ConfigurationError
from maingott_reel.models import CompositionSettings, SafeArea, TextRole
from maingott_reel.video.captions import (
    DEFAULT_STYLES,
    caption_fits,
    find_font,
    font_identity,
    render_caption,
    safe_area_pixels,
    style_for,
)

SETTINGS = CompositionSettings()


@pytest.fixture
def font() -> Path:
    return find_font(None)


def _ink(path: Path) -> int:
    with Image.open(path) as image:
        return sum(1 for value in image.convert("RGBA").getchannel("A").tobytes() if value)


# --- fonts ------------------------------------------------------------------


def test_a_unicode_font_is_found(font: Path):
    assert font.is_file()
    assert font.suffix.lower() in {".ttf", ".otf"}


def test_a_configured_font_is_used(font: Path):
    assert find_font(font) == font


def test_a_missing_configured_font_is_reported(tmp_path: Path):
    with pytest.raises(ConfigurationError, match="not found"):
        find_font(tmp_path / "absent.ttf")


def test_font_identity_changes_with_the_file(font: Path, tmp_path: Path):
    copy = tmp_path / "copy.ttf"
    copy.write_bytes(font.read_bytes() + b"\x00")
    assert font_identity(copy) != font_identity(font)


# --- rendering ---------------------------------------------------------------


def test_cyrillic_text_renders(tmp_path: Path, font: Path):
    path = render_caption("Разные каналы", TextRole.CAPTION, tmp_path / "ru.png", SETTINGS, font)
    with Image.open(path) as image:
        assert image.size == (SETTINGS.width, SETTINGS.height)
        assert image.mode == "RGBA"
    assert _ink(path) > 1000, "Cyrillic text should put ink on the canvas"


def test_latin_and_punctuation_render(tmp_path: Path, font: Path):
    path = render_caption(
        "Sales & Operations OS — 2026", TextRole.CAPTION, tmp_path / "en.png", SETTINGS, font
    )
    assert _ink(path) > 1000


def test_rendering_is_deterministic(tmp_path: Path, font: Path):
    first = render_caption(
        "Один связанный путь", TextRole.CAPTION, tmp_path / "a.png", SETTINGS, font
    )
    second = render_caption(
        "Один связанный путь", TextRole.CAPTION, tmp_path / "b.png", SETTINGS, font
    )
    assert first.read_bytes() == second.read_bytes()


def test_different_text_renders_differently(tmp_path: Path, font: Path):
    first = render_caption("Разные каналы", TextRole.CAPTION, tmp_path / "a.png", SETTINGS, font)
    second = render_caption("Один контур", TextRole.CAPTION, tmp_path / "b.png", SETTINGS, font)
    assert first.read_bytes() != second.read_bytes()


def test_brand_text_is_uppercased_and_centred(tmp_path: Path, font: Path):
    path = render_caption("MainGott", TextRole.BRAND, tmp_path / "brand.png", SETTINGS, font)
    with Image.open(path) as image:
        alpha = image.convert("RGBA").getchannel("A")
        rows = [
            y
            for y in range(0, image.height, 8)
            if any(alpha.crop((0, y, image.width, y + 1)).tobytes())
        ]
    middle = image.height / 2
    assert rows, "brand text should be drawn"
    assert abs(sum(rows) / len(rows) - middle) < image.height * 0.25


def test_captions_stay_inside_the_safe_area(tmp_path: Path, font: Path):
    path = render_caption(
        "Каждое действие становится данными", TextRole.CAPTION, tmp_path / "c.png", SETTINGS, font
    )
    left, top, right, bottom = safe_area_pixels(SETTINGS)
    with Image.open(path) as image:
        alpha = image.convert("RGBA").getchannel("A")
        pixels = alpha.load()
        assert pixels is not None
        for y in range(0, image.height, 4):
            for x in range(0, image.width, 4):
                if pixels[x, y]:
                    assert left - 8 <= x <= right + 8
                    assert top - 8 <= y <= bottom + 8


def test_text_that_cannot_fit_is_refused(tmp_path: Path, font: Path):
    with pytest.raises(ConfigurationError):
        render_caption("Слово " * 60, TextRole.CAPTION, tmp_path / "long.png", SETTINGS, font)


def test_a_single_unbreakable_word_that_is_too_wide_is_refused(tmp_path: Path, font: Path):
    with pytest.raises(ConfigurationError, match="safe area"):
        render_caption("Ж" * 60, TextRole.CAPTION, tmp_path / "wide.png", SETTINGS, font)


def test_empty_text_is_refused(tmp_path: Path, font: Path):
    with pytest.raises(ConfigurationError, match="empty"):
        render_caption("   ", TextRole.CAPTION, tmp_path / "empty.png", SETTINGS, font)


def test_caption_fits_reports_without_rendering(font: Path):
    assert caption_fits("Один контур", TextRole.CAPTION, SETTINGS, font)
    assert not caption_fits("Ж" * 60, TextRole.CAPTION, SETTINGS, font)


def test_text_scales_with_the_canvas(tmp_path: Path, font: Path):
    small = SETTINGS.model_copy(update={"width": 540, "height": 960})
    path = render_caption("Разные каналы", TextRole.CAPTION, tmp_path / "small.png", small, font)
    with Image.open(path) as image:
        assert image.size == (540, 960)


def test_a_tighter_safe_area_moves_the_text(tmp_path: Path, font: Path):
    tighter = SETTINGS.model_copy(update={"safe_area": SafeArea(top=0.3, bottom=0.4)})
    default_path = render_caption(
        "Один контур", TextRole.CAPTION, tmp_path / "d.png", SETTINGS, font
    )
    tight_path = render_caption("Один контур", TextRole.CAPTION, tmp_path / "t.png", tighter, font)
    assert default_path.read_bytes() != tight_path.read_bytes()


def test_every_role_has_a_style():
    for role in TextRole:
        assert style_for(role, DEFAULT_STYLES).role is role
