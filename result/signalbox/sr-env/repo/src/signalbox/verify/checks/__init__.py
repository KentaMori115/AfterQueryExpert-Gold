"""The rules themselves.

Importing this package registers every rule. Adding one means writing the module
and adding it to the list below, which is deliberately manual so that a rule
cannot appear in a report without somebody having decided it should.
"""

from . import (
    aspect,
    capacity,
    crossing,
    detection,
    flank,
    gradient,
    layout,
    locking,
    overlap,
    points,
    protection,
    reversible,
    route,
    setting,
    sighting,
    spacing,
    standards,
)

__all__ = [
    "aspect",
    "capacity",
    "crossing",
    "detection",
    "flank",
    "gradient",
    "layout",
    "locking",
    "overlap",
    "points",
    "protection",
    "reversible",
    "route",
    "setting",
    "sighting",
    "spacing",
    "standards",
]
