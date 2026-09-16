"""Rendering on-screen text.

Captions are drawn here, into transparent PNGs, rather than by FFmpeg's text
filter. That keeps typography under our control, keeps Cyrillic and Latin text
rendering identically on any machine with the configured font, and makes each
caption an inspectable artifact rather than a string buried in a filter graph.

The text itself always comes from the approved storyboard. Nothing in this
module writes or rewrites viewer-facing wording.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from maingott_reel.errors import ConfigurationError
from maingott_reel.models import CompositionSettings, SafeArea, TextRole, TextStyle
from maingott_reel.utils.hashing import sha256_text

#: Fonts to look for when none is configured. All carry Cyrillic and Latin.
FONT_CANDIDATES = (
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"),
    Path("/Library/Fonts/Arial Unicode.ttf"),
)

#: Text sizes for a 1080x1920 canvas, scaled proportionally for others.
DEFAULT_STYLES: tuple[TextStyle, ...] = (
    TextStyle(role=TextRole.TITLE, font_size=92, max_lines=3),
    TextStyle(role=TextRole.SUBTITLE, font_size=64, max_lines=3),
    TextStyle(role=TextRole.CAPTION, font_size=58, max_lines=3),
    TextStyle(role=TextRole.BRAND, font_size=104, uppercase=True, letter_spacing=6.0, max_lines=2),
)

#: The canvas the default sizes were chosen for.
REFERENCE_HEIGHT = 1920


def find_font(configured: Path | None = None) -> Path:
    """Return the font file to draw with.

    Raises:
        ConfigurationError: the configured font is missing, or no bundled
            candidate exists on this machine.
    """
    if configured is not None:
        if not configured.is_file():
            raise ConfigurationError(f"Caption font not found: {configured}")
        return configured
    for candidate in FONT_CANDIDATES:
        if candidate.is_file():
            return candidate
    raise ConfigurationError(
        "No caption font found. Set CAPTION_FONT to a Unicode font file "
        "(DejaVu Sans, Noto Sans or similar)."
    )


def style_for(role: TextRole, styles: tuple[TextStyle, ...] = DEFAULT_STYLES) -> TextStyle:
    """Return the style used for ``role``."""
    return next(style for style in styles if style.role is role)


def _scaled_size(style: TextStyle, height: int) -> int:
    """Scale a style's size to the canvas in use."""
    return max(12, round(style.font_size * height / REFERENCE_HEIGHT))


def _wrap(text: str, font: ImageFont.FreeTypeFont, max_width: int, max_lines: int) -> list[str]:
    """Break ``text`` into lines that fit ``max_width``.

    Raises:
        ConfigurationError: a single word cannot fit, or the text needs more
            lines than the style allows.
    """
    words = text.split()
    if not words:
        raise ConfigurationError("Caption text is empty")

    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if font.getlength(candidate) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)

    too_wide = [line for line in lines if font.getlength(line) > max_width]
    if too_wide:
        raise ConfigurationError(
            f"Caption text does not fit the safe area at this size: {too_wide[0]!r}"
        )
    if len(lines) > max_lines:
        raise ConfigurationError(
            f"Caption text needs {len(lines)} lines but the style allows {max_lines}: {text!r}"
        )
    return lines


def _draw_line(
    draw: ImageDraw.ImageDraw,
    line: str,
    font: ImageFont.FreeTypeFont,
    position: tuple[float, float],
    style: TextStyle,
) -> None:
    """Draw one line with its shadow, honouring letter spacing."""
    x, y = position
    if style.letter_spacing <= 0:
        draw.text(
            (x + style.shadow_offset, y + style.shadow_offset),
            line,
            font=font,
            fill=style.shadow_color,
        )
        draw.text((x, y), line, font=font, fill=style.color)
        return
    cursor = x
    for character in line:
        draw.text(
            (cursor + style.shadow_offset, y + style.shadow_offset),
            character,
            font=font,
            fill=style.shadow_color,
        )
        draw.text((cursor, y), character, font=font, fill=style.color)
        cursor += font.getlength(character) + style.letter_spacing


def _line_width(line: str, font: ImageFont.FreeTypeFont, style: TextStyle) -> float:
    """Width of a line including letter spacing."""
    if style.letter_spacing <= 0:
        return font.getlength(line)
    return sum(font.getlength(character) + style.letter_spacing for character in line) - (
        style.letter_spacing if line else 0
    )


def render_caption(
    text: str,
    role: TextRole,
    destination: Path,
    settings: CompositionSettings,
    font_path: Path,
    styles: tuple[TextStyle, ...] = DEFAULT_STYLES,
) -> Path:
    """Draw one caption onto a transparent frame-sized PNG.

    The image is deterministic: the same text, role, settings and font always
    produce the same bytes.

    Raises:
        ConfigurationError: the text does not fit the safe area.
    """
    style = style_for(role, styles)
    content = text.upper() if style.uppercase else text
    size = _scaled_size(style, settings.height)
    font = ImageFont.truetype(str(font_path), size)

    left, top, right, bottom = settings.safe_area.box(settings.width, settings.height)
    max_width = right - left
    lines = _wrap(content, font, max_width, style.max_lines)

    line_height = size * style.line_spacing
    block_height = line_height * len(lines)
    if block_height > bottom - top:
        raise ConfigurationError(
            f"Caption needs {round(block_height)}px but the safe area is {bottom - top}px tall"
        )

    # Captions sit low in the frame; brand text sits in the middle.
    if role is TextRole.BRAND:
        start_y = top + (bottom - top - block_height) / 2
    else:
        start_y = bottom - block_height

    image = Image.new("RGBA", (settings.width, settings.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(lines):
        width = _line_width(line, font, style)
        x = left + (max_width - width) / 2
        y = start_y + index * line_height
        _draw_line(draw, line, font, (x, y), style)

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG", optimize=True)
    return destination


def caption_fits(text: str, role: TextRole, settings: CompositionSettings, font_path: Path) -> bool:
    """Whether ``text`` can be drawn inside the safe area."""
    style = style_for(role)
    content = text.upper() if style.uppercase else text
    font = ImageFont.truetype(str(font_path), _scaled_size(style, settings.height))
    left, _, right, _ = settings.safe_area.box(settings.width, settings.height)
    try:
        _wrap(content, font, right - left, style.max_lines)
    except ConfigurationError:
        return False
    return True


def font_identity(font_path: Path) -> str:
    """A stable identity for a font file, used in the composition hash."""
    return sha256_text(f"{font_path.name}:{font_path.stat().st_size}")


def safe_area_pixels(settings: CompositionSettings) -> tuple[int, int, int, int]:
    """The usable text box in pixels, for reporting."""
    area: SafeArea = settings.safe_area
    return area.box(settings.width, settings.height)
