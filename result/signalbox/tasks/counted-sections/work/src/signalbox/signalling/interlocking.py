"""Everything worked out about one scheme, gathered in one place.

Routes on their own are not much use. What the rest of the toolkit wants is a
route together with its overlaps and its flanks, and a way of asking for those
by name. That is an :class:`Interlocking`, and building one is the single
expensive step every command does first.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field

from ..errors import InterlockingError
from ..topology.graph import Lie
from ..topology.scheme import Scheme
from ..units import Distance
from .flank import Flank, flanks_for, unprotected
from .overlap import Overlap, overlaps_for, preferred
from .route import Route, RouteClass
from .routefind import all_routes
from .subroute import Subroute, subroutes_over


@dataclass(frozen=True)
class RoutePlan:
    """A route with everything the interlocking has to do about it."""

    route: Route
    overlaps: tuple[Overlap, ...] = ()
    flanks: tuple[Flank, ...] = ()
    track: tuple[Subroute, ...] = ()
    overlap_track: tuple[Subroute, ...] = ()

    @property
    def name(self) -> str:
        return self.route.name

    @property
    def entrance(self) -> str:
        return self.route.entrance

    @property
    def exit(self) -> str:
        return self.route.exit.name

    @property
    def klass(self) -> RouteClass:
        return self.route.klass

    @property
    def sections(self) -> tuple[str, ...]:
        return self.route.sections

    @property
    def overlap(self) -> Overlap | None:
        return preferred(list(self.overlaps))

    @property
    def swinging_overlap(self) -> bool:
        return len(self.overlaps) > 1

    def held_track(self) -> tuple[Subroute, ...]:
        return self.track + self.overlap_track

    def overlap_sections(self) -> tuple[str, ...]:
        seen: list[str] = []
        for overlap in self.overlaps:
            for section in overlap.sections:
                if section not in seen and section not in self.sections:
                    seen.append(section)
        return tuple(seen)

    def points(self) -> Mapping[str, Lie]:
        return self.route.points

    def overlap_points(self) -> Mapping[str, Lie]:
        overlap = self.overlap
        return overlap.points if overlap else {}

    def flank_points(self) -> Mapping[str, Lie]:
        wanted: dict[str, Lie] = {}
        for flank in self.flanks:
            if flank.element is not None and flank.lie is not None:
                wanted[flank.element] = flank.lie
        return wanted

    def signals_held(self) -> tuple[str, ...]:
        return tuple(
            sorted({f.element for f in self.flanks if f.kind.value == "signal" and f.element})
        )

    def unprotected_flanks(self) -> tuple[Flank, ...]:
        return tuple(unprotected(list(self.flanks)))

    def __str__(self) -> str:
        return f"{self.name} to {self.route.exit}"


@dataclass
class Interlocking:
    """The routes of a scheme and what each of them locks."""

    scheme: Scheme
    plans: dict[str, RoutePlan] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.plans)

    def __iter__(self) -> Iterator[RoutePlan]:
        return iter(self.sorted_plans())

    def __contains__(self, name: object) -> bool:
        return name in self.plans

    def sorted_plans(self) -> list[RoutePlan]:
        return [self.plans[name] for name in sorted(self.plans)]

    def plan(self, name: str) -> RoutePlan:
        try:
            return self.plans[name]
        except KeyError:
            raise InterlockingError(f"no route called {name}") from None

    def routes(self) -> list[Route]:
        return [plan.route for plan in self.sorted_plans()]

    def from_signal(self, signal: str) -> list[RoutePlan]:
        return [plan for plan in self.sorted_plans() if plan.entrance == signal]

    def to_signal(self, signal: str) -> list[RoutePlan]:
        return [plan for plan in self.sorted_plans() if plan.exit == signal]

    def over_section(self, section: str) -> list[RoutePlan]:
        return [
            plan
            for plan in self.sorted_plans()
            if section in plan.sections or section in plan.overlap_sections()
        ]

    def describe(self) -> str:
        swinging = sum(1 for plan in self.plans.values() if plan.swinging_overlap)
        return (
            f"{len(self.plans)} routes, {swinging} with a swinging overlap, "
            f"over {len(self.scheme.sections)} sections"
        )


def build_interlocking(
    scheme: Scheme,
    *,
    overlap: Distance | None = None,
    flank_search: Distance | None = None,
    route_limit: Distance | None = None,
) -> Interlocking:
    """Find every route in ``scheme`` and work out its overlaps and flanks.

    The figures come from the scheme's own design standards unless the caller
    says otherwise, so a scheme drawn to a two hundred metre overlap is checked
    against a two hundred metre overlap.
    """
    overlap = overlap if overlap is not None else scheme.standards.overlap
    flank_search = flank_search if flank_search is not None else scheme.standards.flank
    route_limit = route_limit if route_limit is not None else scheme.standards.route_limit
    interlocking = Interlocking(scheme=scheme)
    for route in all_routes(scheme, limit=route_limit):
        overlaps = tuple(overlaps_for(scheme, route, standard=overlap))
        first = preferred(list(overlaps))
        flanks = tuple(
            flanks_for(
                scheme,
                route,
                overlap_edges=first.edges if first else (),
                search=flank_search,
            )
        )
        track = subroutes_over(scheme, route.path.steps)
        overlap_track: tuple[Subroute, ...] = ()
        if first is not None:
            covered = {sub.section for sub in track}
            overlap_track = tuple(
                sub for sub in subroutes_over(scheme, first.steps) if sub.section not in covered
            )
        interlocking.plans[route.name] = RoutePlan(
            route, overlaps, flanks, track, overlap_track
        )
    return interlocking
