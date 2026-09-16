"""Stub of configlayer.source — dict and file layers."""

import json
import os

from configlayer.env import _coerce


class DictSource:
    def __init__(self, data, name="dict", priority=0):
        self.data, self.name, self.priority = data, name, priority

    def load(self):
        return self.data


class FileSource:
    def __init__(self, path, name=None, priority=0):
        self.path = path
        self.name = name or os.path.basename(path)
        self.priority = priority

    def load(self):
        text = open(self.path, encoding="utf-8").read()
        if self.path.endswith(".json"):
            return json.loads(text)
        pairs = {}
        for line in text.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            key, _, value = line.partition("=")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            pairs[key.strip()] = value
        return pairs
