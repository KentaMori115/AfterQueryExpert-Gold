"""Stub of configlayer.loader — INI and by-extension loading."""

import configparser
import json

from configlayer.env import _coerce


class INILoader:
    """Parse INI text with interpolation disabled."""

    def load(self, text):
        parser = configparser.ConfigParser(interpolation=None)
        parser.optionxform = str
        parser.read_string(text)
        out = {}
        for section in parser.sections():
            out[section] = {k: _coerce(v) for k, v in parser.items(section)}
        return out


def load_file_like(name, text):
    if name.endswith(".ini"):
        return INILoader().load(text)
    if name.endswith(".json"):
        return json.loads(text)
    raise ValueError(name)
