"""Integer 2-D geometry. Distances use integer square-root rounding."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Point:
    x: int
    y: int


def squared_distance(a: Point, b: Point) -> int:
    dx = b.x - a.x
    dy = b.y - a.y
    return dx * dx + dy * dy


def distance_units(a: Point, b: Point) -> int:
    """Nearest integer square root of d². Exact ties round upward."""
    squared = squared_distance(a, b)
    root = math.isqrt(squared)
    lower = root * root
    upper = (root + 1) * (root + 1)
    if squared - lower < upper - squared:
        return root
    if upper - squared < squared - lower:
        return root + 1
    return root + 1
