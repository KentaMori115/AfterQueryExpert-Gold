"""YAML loader that preserves numeric tokens as decimal text and node positions."""

from __future__ import annotations

from typing import Any

import copy

import yaml
from yaml.error import Mark
from yaml.events import AliasEvent
from yaml.nodes import MappingNode, Node, ScalarNode, SequenceNode

from cueforge.findings import SourceRef
from cueforge.production.source_map import NodePath, SourceMap


class DecimalSafeLoader(yaml.SafeLoader):
    """SafeLoader that does not implicitly convert ints, floats, or timestamps."""


def _keep_plain_scalars_as_text() -> None:
    for ch, resolvers in list(DecimalSafeLoader.yaml_implicit_resolvers.items()):
        DecimalSafeLoader.yaml_implicit_resolvers[ch] = [
            (tag, regexp)
            for tag, regexp in resolvers
            if not tag.endswith(("int", "float", "timestamp"))
        ]


_keep_plain_scalars_as_text()


def _node_value(loader: DecimalSafeLoader, node: Node) -> Any:
    if isinstance(node, ScalarNode):
        if node.tag == "tag:yaml.org,2002:null" or (
            node.value in {"null", "Null", "NULL", "~"} and node.implicit[0]
        ):
            return None
        if node.tag == "tag:yaml.org,2002:bool" and node.value in {
            "true",
            "True",
            "TRUE",
            "false",
            "False",
            "FALSE",
        }:
            return node.value in {"true", "True", "TRUE"}
        if node.tag == "tag:yaml.org,2002:str" or node.tag == "tag:yaml.org,2002:value":
            return node.value
        # Quoted or plain scalars stay as authored text so 1.4 never becomes a float.
        return node.value
    if isinstance(node, SequenceNode):
        return [_node_value(loader, child) for child in node.value]
    if isinstance(node, MappingNode):
        mapping: dict[str, Any] = {}
        for key_node, value_node in node.value:
            key = _node_value(loader, key_node)
            mapping[str(key)] = _node_value(loader, value_node)
        return mapping
    return None


def parse_yaml_text(text: str) -> Any:
    loader = DecimalSafeLoader(text)
    try:
        node = loader.get_single_node()
        if node is None:
            return None
        return _node_value(loader, node)
    finally:
        loader.dispose()


def _content_mark(mark: Mark) -> Mark:
    """The mark of a node's content, past any ``&anchor`` or ``!tag`` in front of it.

    PyYAML starts an anchored node at the ``&``; the anchor names the node and
    the node itself opens after it, at its first key, its ``{`` or its quote.
    """
    text = mark.buffer or ""
    index = mark.index
    while index < len(text):
        char = text[index]
        if char in "&!":
            index += 1
            while index < len(text) and text[index] not in " \t\r\n\0[]{},":
                index += 1
        elif char in " \t\r\n":
            index += 1
        elif char == "#":
            while index < len(text) and text[index] != "\n":
                index += 1
        else:
            break
    line = text.count("\n", 0, index)
    column = index - (text.rfind("\n", 0, index) + 1)
    return Mark(mark.name, index, line, column, mark.buffer, mark.pointer)


class _PositionLoader(DecimalSafeLoader):
    """Composer that remembers alias sites and starts anchored nodes at their content."""

    def compose_node(self, parent: Node | None, index: Any) -> Node:  # type: ignore[override]
        event = self.peek_event()
        node = super().compose_node(parent, index)
        if isinstance(event, AliasEvent):
            # The composer hands back the anchored node itself; keep it shared
            # for values but remember where the reuse was written.
            reached = copy.copy(node)
            reached.alias_mark = event.start_mark  # type: ignore[attr-defined]
            return reached
        if node is not None and getattr(event, "anchor", None) is not None:
            node.start_mark = _content_mark(event.start_mark)
        return node


def _ref(mark: Mark, path: str) -> SourceRef:
    return SourceRef(path=path, line=mark.line + 1, column=mark.column + 1)


def _positioned_value(
    loader: DecimalSafeLoader,
    node: Node,
    positions: SourceMap,
    path: str,
    at: NodePath,
    through: SourceRef | None = None,
) -> Any:
    """Like ``_node_value``, recording where every node and key starts.

    ``through`` is the ``*alias`` the walk came in by, if any: everything
    reached through an alias points at that alias, and an alias met inside
    another keeps the outer one, so a finding names the outermost reuse the
    author wrote rather than the anchor the text was taken from.
    """
    alias_mark = getattr(node, "alias_mark", None)
    if through is None and alias_mark is not None:
        through = _ref(alias_mark, path)
    positions.add_value(at, through if through is not None else _ref(node.start_mark, path))
    if isinstance(node, SequenceNode):
        return [
            _positioned_value(loader, child, positions, path, (*at, index), through)
            for index, child in enumerate(node.value)
        ]
    if isinstance(node, MappingNode):
        mapping: dict[str, Any] = {}
        for key_node, value_node in node.value:
            key = str(_node_value(loader, key_node))
            positions.add_key(
                (*at, key), through if through is not None else _ref(key_node.start_mark, path)
            )
            mapping[key] = _positioned_value(
                loader, value_node, positions, path, (*at, key), through
            )
        return mapping
    return _node_value(loader, node)


def parse_yaml_with_positions(text: str, path: str) -> tuple[Any, SourceMap]:
    """Parse ``text`` like :func:`parse_yaml_text` and record every node's position."""
    positions = SourceMap()
    loader = _PositionLoader(text)
    try:
        node = loader.get_single_node()
        if node is None:
            return None, positions
        return _positioned_value(loader, node, positions, path, ()), positions
    finally:
        loader.dispose()
