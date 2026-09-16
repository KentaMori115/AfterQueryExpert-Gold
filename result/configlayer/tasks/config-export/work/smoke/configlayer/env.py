"""Stub of configlayer.env — the dotenv reader this export inverts."""


def _coerce(text):
    low = text.strip().lower()
    if low in ("true", "false"):
        return low == "true"
    if low == "":
        return ""
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        return text


def parse_env(pairs, prefix=""):
    """Turn ENV__STYLE__NAMES back into a nested mapping."""
    out = {}
    for name, value in pairs.items():
        if prefix and not name.startswith(prefix):
            continue
        rest = name[len(prefix):] if prefix else name
        node = out
        segments = [s.lower() for s in rest.split("__")]
        for seg in segments[:-1]:
            node = node.setdefault(seg, {})
        node[segments[-1]] = _coerce(value)
    return out
