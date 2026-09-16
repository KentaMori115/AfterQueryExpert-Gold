"""Stub of configlayer.layers — a priority-ordered merge with provenance."""

from collections.abc import Mapping


class LayeredConfig:
    def __init__(self, sources):
        self.sources = sorted(sources, key=lambda s: getattr(s, "priority", 0))

    def as_dict(self):
        out = {}
        for source in self.sources:
            _merge(out, source.load())
        return out

    def __getitem__(self, dotted):
        node = self.as_dict()
        for seg in dotted.split("."):
            node = node[seg]
        return node

    def origin(self, dotted):
        winner = None
        for source in self.sources:
            node = source.load()
            try:
                for seg in dotted.split("."):
                    node = node[seg]
            except (KeyError, TypeError):
                continue
            winner = source.name
        return winner


def _merge(into, new):
    for key, value in new.items():
        if isinstance(value, Mapping) and isinstance(into.get(key), Mapping):
            _merge(into[key], value)
        else:
            into[key] = value
