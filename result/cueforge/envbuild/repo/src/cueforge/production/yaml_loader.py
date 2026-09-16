"""YAML loader that preserves numeric tokens as decimal text."""

from __future__ import annotations

from typing import Any

import yaml
from yaml.nodes import MappingNode, Node, ScalarNode, SequenceNode


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
