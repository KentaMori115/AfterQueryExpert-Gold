"""Minimal stub: only what select_origins touches (as_dict, origin)."""


class LayeredConfig:
    def __init__(self, resolved, origins):
        self._resolved = resolved
        self._origins = origins

    def as_dict(self):
        return self._resolved

    def origin(self, path):
        return self._origins.get(path)


class LayerStack:
    pass
