"""Writing a scheme plan back out in a canonical shape.

Two people editing the same plan will not lay it out the same way, and the
difference shows up in every review afterwards as noise. Printing the parsed
declarations back out settles it: the file is grouped by kind, the columns line
up, and a plan that has not changed in substance does not change in the diff.

What is lost is comments, which the parser throws away. That is the price, and
it is why the formatter is a command somebody runs rather than something that
happens on the way past.
"""

from __future__ import annotations

from .ast import (
    CrossingDecl,
    EdgeDecl,
    Facing,
    NodeDecl,
    SchemeDecl,
    SectionDecl,
    SectionKind,
    SignalDecl,
    TrapDecl,
)

INDENT = "    "


def _number(value: float) -> str:
    """Whole numbers without a decimal point, everything else with one."""
    if value == int(value):
        return str(int(value))
    return f"{value:g}"


def _quote(value: str) -> str:
    if value and all(ch.isalnum() or ch in "_/-" for ch in value):
        return value
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _attributes(attributes: dict[str, str]) -> str:
    return "".join(f" {key} {_quote(value)}" for key, value in sorted(attributes.items()))


def format_scheme_block(scheme: SchemeDecl) -> list[str]:
    if scheme.area is None and scheme.prefix is None and scheme.name == "unnamed":
        return []
    lines = [f"scheme {scheme.name} {{"]
    if scheme.area is not None:
        lines.append(f"{INDENT}area {_quote(scheme.area)}")
    if scheme.prefix is not None:
        lines.append(f"{INDENT}prefix {_quote(scheme.prefix)}")
    lines.append("}")
    return lines


def format_node(decl: NodeDecl, width: int = 0) -> str:
    line = f"node {decl.name.ljust(width)} {decl.kind.value}"
    return (line + _attributes(decl.attributes)).rstrip()


def format_edge(decl: EdgeDecl, width: int = 0) -> str:
    parts = [
        f"edge {decl.name.ljust(width)}",
        f"from {decl.start} to {decl.end}",
        f"length {_number(decl.length_metres)}",
    ]
    if decl.speed_mph is not None:
        parts.append(f"speed {_number(decl.speed_mph)}")
    if decl.gradient is not None:
        parts.append(f"gradient {decl.gradient}")
    return " ".join(parts) + _attributes(decl.attributes)


def format_section(decl: SectionDecl, width: int = 0) -> str:
    counted = " counted" if decl.kind is SectionKind.AXLE_COUNTER else ""
    return f"section {decl.name.ljust(width)}{counted} over {', '.join(decl.edges)}"


def format_signal(decl: SignalDecl, width: int = 0) -> str:
    facing = "forward" if decl.facing is Facing.FORWARD else "backward"
    line = (
        f"signal {decl.name.ljust(width)} on {decl.edge} "
        f"at {_number(decl.offset_metres)} facing {facing}"
    )
    return line + _attributes(decl.attributes) + f" aspects {decl.aspects}"


def format_crossing(decl: CrossingDecl, width: int = 0) -> str:
    line = (
        f"crossing {decl.name.ljust(width)} on {decl.edge} "
        f"at {_number(decl.offset_metres)} type {decl.kind.value}"
    )
    return line + _attributes(decl.attributes)


def format_trap(decl: TrapDecl, width: int = 0) -> str:
    facing = "forward" if decl.facing is Facing.FORWARD else "backward"
    line = (
        f"trap {decl.name.ljust(width)} on {decl.edge} "
        f"at {_number(decl.offset_metres)} facing {facing}"
    )
    return line + _attributes(decl.attributes)


def _width(names: list[str]) -> int:
    return max((len(name) for name in names), default=0)


def format_scheme(scheme: SchemeDecl) -> str:
    """The whole plan, grouped and lined up."""
    blocks: list[list[str]] = []

    header = format_scheme_block(scheme)
    if header:
        blocks.append(header)

    if scheme.nodes:
        width = _width([decl.name for decl in scheme.nodes])
        blocks.append([format_node(decl, width) for decl in scheme.nodes])
    if scheme.edges:
        width = _width([decl.name for decl in scheme.edges])
        blocks.append([format_edge(decl, width) for decl in scheme.edges])
    if scheme.sections:
        width = _width([decl.name for decl in scheme.sections])
        blocks.append([format_section(decl, width) for decl in scheme.sections])
    if scheme.signals:
        width = _width([decl.name for decl in scheme.signals])
        blocks.append([format_signal(decl, width) for decl in scheme.signals])
    if scheme.crossings:
        width = _width([decl.name for decl in scheme.crossings])
        blocks.append([format_crossing(decl, width) for decl in scheme.crossings])
    if scheme.traps:
        width = _width([decl.name for decl in scheme.traps])
        blocks.append([format_trap(decl, width) for decl in scheme.traps])

    if not blocks:
        return ""
    return "\n\n".join("\n".join(block) for block in blocks) + "\n"
