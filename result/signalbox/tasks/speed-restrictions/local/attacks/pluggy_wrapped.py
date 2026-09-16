
import pluggy._callers as _c
_orig = _c._multicall
def _wrapped(*a, **k):
    return _orig(*a, **k)
_c._multicall = _wrapped
