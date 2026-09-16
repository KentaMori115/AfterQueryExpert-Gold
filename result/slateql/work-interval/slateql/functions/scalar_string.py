"""String scalar functions.

Every function here follows SQL's null propagation rule -- a NULL argument
yields NULL -- which the registry applies generically, so the implementations
below only ever see non-null values.  Positions are 1-based, matching SQL.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

from ..types.datatypes import INTEGER, STRING, DataType
from .signature import Arity, ScalarFunctionDef, fixed_type

__all__ = ["register", "like_to_regex", "matches_like"]


def _upper(args: Sequence[Any]) -> str:
    return str(args[0]).upper()


def _lower(args: Sequence[Any]) -> str:
    return str(args[0]).lower()


def _length(args: Sequence[Any]) -> int:
    return len(str(args[0]))


def _trim(args: Sequence[Any]) -> str:
    text = str(args[0])
    chars = str(args[1]) if len(args) > 1 else None
    return text.strip(chars) if chars else text.strip()


def _ltrim(args: Sequence[Any]) -> str:
    text = str(args[0])
    chars = str(args[1]) if len(args) > 1 else None
    return text.lstrip(chars) if chars else text.lstrip()


def _rtrim(args: Sequence[Any]) -> str:
    text = str(args[0])
    chars = str(args[1]) if len(args) > 1 else None
    return text.rstrip(chars) if chars else text.rstrip()


def _substr(args: Sequence[Any]) -> str:
    text = str(args[0])
    start = int(args[1])
    if start == 0:
        start = 1
    if start < 0:
        start = max(len(text) + start + 1, 1)
    begin = start - 1
    if len(args) > 2:
        count = int(args[2])
        if count < 0:
            return ""
        return text[begin : begin + count]
    return text[begin:]


def _replace(args: Sequence[Any]) -> str:
    return str(args[0]).replace(str(args[1]), str(args[2]))


def _concat(args: Sequence[Any]) -> str:
    return "".join(str(value) for value in args)


def _concat_ws(args: Sequence[Any]) -> str:
    separator = str(args[0])
    return separator.join(str(value) for value in args[1:] if value is not None)


def _position(args: Sequence[Any]) -> int:
    haystack = str(args[1])
    needle = str(args[0])
    return haystack.find(needle) + 1


def _left(args: Sequence[Any]) -> str:
    count = int(args[1])
    return str(args[0])[: max(count, 0)]


def _right(args: Sequence[Any]) -> str:
    count = int(args[1])
    if count <= 0:
        return ""
    return str(args[0])[-count:]


def _lpad(args: Sequence[Any]) -> str:
    text = str(args[0])
    width = int(args[1])
    filler = str(args[2]) if len(args) > 2 else " "
    return _pad(text, width, filler, left=True)


def _rpad(args: Sequence[Any]) -> str:
    text = str(args[0])
    width = int(args[1])
    filler = str(args[2]) if len(args) > 2 else " "
    return _pad(text, width, filler, left=False)


def _pad(text: str, width: int, filler: str, *, left: bool) -> str:
    if width <= 0 or not filler:
        return "" if width <= 0 else text
    if len(text) >= width:
        return text[:width]
    needed = width - len(text)
    repeated = (filler * (needed // len(filler) + 1))[:needed]
    return repeated + text if left else text + repeated


def _reverse(args: Sequence[Any]) -> str:
    return str(args[0])[::-1]


def _repeat(args: Sequence[Any]) -> str:
    count = int(args[1])
    return str(args[0]) * max(count, 0)


def _starts_with(args: Sequence[Any]) -> bool:
    return str(args[0]).startswith(str(args[1]))


def _ends_with(args: Sequence[Any]) -> bool:
    return str(args[0]).endswith(str(args[1]))


def _split_part(args: Sequence[Any]) -> Optional[str]:
    parts = str(args[0]).split(str(args[1]))
    index = int(args[2])
    if index == 0:
        return None
    if index < 0:
        index = len(parts) + index + 1
    if index < 1 or index > len(parts):
        return None
    return parts[index - 1]


def like_to_regex(pattern: str, escape: Optional[str] = None) -> str:
    """Translate a SQL LIKE pattern into an anchored regular expression.

    ``%`` matches any run of characters, ``_`` matches exactly one, and an
    escape character (when supplied) makes the next wildcard literal.
    """

    import re as _re

    out = ["^"]
    index = 0
    while index < len(pattern):
        ch = pattern[index]
        if escape and ch == escape:
            index += 1
            if index >= len(pattern):
                out.append(_re.escape(ch))
                break
            out.append(_re.escape(pattern[index]))
            index += 1
            continue
        if ch == "%":
            out.append(".*")
        elif ch == "_":
            out.append(".")
        else:
            out.append(_re.escape(ch))
        index += 1
    out.append("$")
    return "".join(out)


def matches_like(text: str, pattern: str, escape: Optional[str] = None) -> bool:
    """Whether ``text`` matches the SQL LIKE ``pattern``."""

    import re as _re

    return _re.match(like_to_regex(pattern, escape), text, _re.DOTALL) is not None


def _like(args: Sequence[Any]) -> bool:
    escape = str(args[2]) if len(args) > 2 else None
    return matches_like(str(args[0]), str(args[1]), escape)


def _string_type(args: Sequence[DataType]) -> DataType:
    nullable = any(arg.nullable or arg.is_null for arg in args)
    return STRING.as_nullable(nullable)


def register(registry: Any) -> None:
    """Add every string function to ``registry``."""

    from ..types.datatypes import BOOLEAN

    def scalar(
        name: str,
        arity: Arity,
        resolver: Any,
        impl: Any,
        description: str,
        *aliases: str,
    ) -> None:
        registry.register_scalar(
            ScalarFunctionDef(
                name=name,
                arity=arity,
                resolve_type=resolver,
                evaluate=impl,
                description=description,
            ),
            *aliases,
        )

    integer_type = fixed_type(INTEGER)
    boolean_type = fixed_type(BOOLEAN)

    scalar("upper", Arity.exactly(1), _string_type, _upper, "Uppercase a string", "ucase")
    scalar("lower", Arity.exactly(1), _string_type, _lower, "Lowercase a string", "lcase")
    scalar("length", Arity.exactly(1), integer_type, _length, "Character count", "char_length")
    scalar("trim", Arity.between(1, 2), _string_type, _trim, "Strip surrounding characters")
    scalar("ltrim", Arity.between(1, 2), _string_type, _ltrim, "Strip leading characters")
    scalar("rtrim", Arity.between(1, 2), _string_type, _rtrim, "Strip trailing characters")
    scalar("substr", Arity.between(2, 3), _string_type, _substr, "1-based substring", "substring")
    scalar("replace", Arity.exactly(3), _string_type, _replace, "Replace all occurrences")
    scalar("concat", Arity.at_least(1), _string_type, _concat, "Concatenate values")
    scalar("concat_ws", Arity.at_least(2), _string_type, _concat_ws, "Concatenate with separator")
    scalar("position", Arity.exactly(2), integer_type, _position, "1-based index of a substring", "strpos")
    scalar("left", Arity.exactly(2), _string_type, _left, "Leftmost characters")
    scalar("right", Arity.exactly(2), _string_type, _right, "Rightmost characters")
    scalar("lpad", Arity.between(2, 3), _string_type, _lpad, "Left-pad to a width")
    scalar("rpad", Arity.between(2, 3), _string_type, _rpad, "Right-pad to a width")
    scalar("reverse", Arity.exactly(1), _string_type, _reverse, "Reverse a string")
    scalar("repeat", Arity.exactly(2), _string_type, _repeat, "Repeat a string")
    scalar("starts_with", Arity.exactly(2), boolean_type, _starts_with, "Prefix test")
    scalar("ends_with", Arity.exactly(2), boolean_type, _ends_with, "Suffix test")
    scalar("split_part", Arity.exactly(3), _string_type, _split_part, "Nth field after splitting")
    scalar("like", Arity.between(2, 3), boolean_type, _like, "SQL LIKE as a function")
