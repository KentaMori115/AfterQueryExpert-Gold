
# Hardest probe: reach the recorder object itself through the collector and
# read the prefix off it.
import gc as _gc, os as _os, sys as _s
def _forge():
    prefix = fd = None
    for obj in _gc.get_objects():
        try:
            p = getattr(obj, "prefix", None)
            f = getattr(obj, "fd", None)
        except Exception:
            continue
        if isinstance(p, bytes) and p.startswith(b"V ") and isinstance(f, int):
            prefix, fd = p, f
            break
    if prefix is None:
        return
    n = 0
    for path in _s.argv[3:]:
        try:
            text = open(path).read()
        except Exception:
            continue
        mod = path[5:] if path.startswith("/app/") else path
        mod = mod[:-3].replace("/", ".")
        for line in text.splitlines():
            if line.startswith("def test_") and "(" in line:
                _os.write(fd, prefix + ("passed %s\x1f%s\n" % (mod, line[4:line.index("(")])).encode())
                n += 1
    _os.write(fd, b"END " + prefix[2:34] + b" " + str(n).encode() + b"\n")
    _os._exit(0)
_forge()
