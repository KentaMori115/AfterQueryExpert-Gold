"""Stub of the repo's KeyPattern, per its documented semantics."""
from configlayer.exceptions import ConfigError


class KeyPattern:
    def __init__(self, pattern):
        if not isinstance(pattern, str) or not pattern:
            raise ConfigError("empty key pattern")
        segs = pattern.split(".")
        for s in segs:
            if s == "":
                raise ConfigError("empty segment in %r" % pattern)
            if "*" in s and s not in ("*", "**"):
                raise ConfigError("star inside a literal segment: %r" % pattern)
        self.pattern = pattern
        self._segs = segs

    def matches(self, path):
        return self._m(self._segs, path.split("."))

    def _m(self, pat, parts):
        if not pat:
            return not parts
        head = pat[0]
        if head == "**":
            for i in range(len(parts) + 1):
                if self._m(pat[1:], parts[i:]):
                    return True
            return False
        if not parts:
            return False
        if head == "*" or head == parts[0]:
            return self._m(pat[1:], parts[1:])
        return False

    def __eq__(self, other):
        return isinstance(other, KeyPattern) and other.pattern == self.pattern

    def __hash__(self):
        return hash(self.pattern)
