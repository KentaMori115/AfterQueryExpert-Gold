"""signalbox: interlocking design and verification for railway signalling schemes.

The package is layered. Nothing in ``signalbox.topology`` or ``signalbox.signalling``
touches the filesystem or the terminal; the only I/O lives in ``signalbox.layout``
(reading scheme plans) and ``signalbox.cli``.

The short way in is here:

    import signalbox

    scheme = signalbox.load("kingsmoor.sbx")
    report = signalbox.check(scheme)
    table = signalbox.control_table(scheme)

Everything those return is documented where it lives, and the subpackages are
public: this is a shortcut, not a wall.
"""

from .api import check, control_table, interlocking, load, parse
from .errors import (
    InterlockingError,
    LayoutError,
    ParseError,
    RoutingError,
    SignalboxError,
    TopologyError,
    UnitError,
)
from .units import Distance, Gradient, Speed

__version__ = "0.3.0"

__all__ = [
    "Distance",
    "Gradient",
    "InterlockingError",
    "LayoutError",
    "ParseError",
    "RoutingError",
    "SignalboxError",
    "Speed",
    "TopologyError",
    "UnitError",
    "__version__",
    "check",
    "control_table",
    "interlocking",
    "load",
    "parse",
]
