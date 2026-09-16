"""The figures a scheme is designed to, in one place.

Overlap length, braking rate, how far to look for flank protection: every one of
these is a decision somebody made for the route, not a law of nature, and a
scheme drawn to different figures is not wrong, it is different. Putting them in
the plan means the checks run against the standards the scheme was actually
designed to rather than against the ones this package happens to default to.
"""

from __future__ import annotations

from dataclasses import dataclass

from .errors import LayoutError
from .units import Distance

#: The name of each figure, and what it means, for error messages and help.
FIGURES = {
    "overlap": "standard overlap length in metres",
    "reduced_overlap": "shortened overlap length in metres",
    "braking": "service braking rate in metres per second squared",
    "reaction": "driver reaction time in seconds",
    "flank": "how far to look for flank protection, in metres",
    "approach": "shortest approach release delay in seconds",
    "throw": "default point throw time in seconds",
    "route_limit": "how far route finding will walk, in metres",
}


@dataclass(frozen=True)
class Standards:
    """The design figures for one scheme."""

    overlap: Distance = Distance(183.0)
    reduced_overlap: Distance = Distance(46.0)
    braking: float = 0.45
    reaction: float = 4.0
    flank: Distance = Distance(400.0)
    approach: float = 120.0
    throw: float = 6.0
    route_limit: Distance = Distance(8000.0)

    @classmethod
    def from_settings(cls, settings: dict[str, float]) -> Standards:
        """Build from the numbers written in a plan, keeping the defaults."""
        unknown = sorted(set(settings) - set(FIGURES))
        if unknown:
            raise LayoutError(
                f"unknown design figure {unknown[0]!r}, "
                f"expected one of {', '.join(sorted(FIGURES))}"
            )
        for name, value in settings.items():
            if value <= 0:
                raise LayoutError(f"{name} has to be greater than zero, got {value}")

        return cls(
            overlap=Distance(settings.get("overlap", 183.0)),
            reduced_overlap=Distance(settings.get("reduced_overlap", 46.0)),
            braking=settings.get("braking", 0.45),
            reaction=settings.get("reaction", 4.0),
            flank=Distance(settings.get("flank", 400.0)),
            approach=settings.get("approach", 120.0),
            throw=settings.get("throw", 6.0),
            route_limit=Distance(settings.get("route_limit", 8000.0)),
        )

    def describe(self) -> str:
        return (
            f"overlap {self.overlap.metres:.0f}m, braking {self.braking:.2f} m/s2, "
            f"flank search {self.flank.metres:.0f}m, approach {self.approach:.0f}s"
        )

    def __str__(self) -> str:
        return self.describe()


#: What a scheme gets when it says nothing.
DEFAULT_STANDARDS = Standards()
