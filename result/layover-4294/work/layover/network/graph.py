"""The shape of the network ignoring the timetable: what connects to what.

A journey search asks when. These questions are about whether: which stops a
vehicle ever runs between, which stops are one change apart, and whether the
feed is one network or two networks that happen to share a file. None of it
looks at a trip or a date, so the answers hold for the whole feed at once.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Set, Tuple

from layover.errors import NetworkError

__all__ = [
    "components",
    "hops_between",
    "is_connected",
    "neighbours",
    "reachable_stops",
    "route_neighbours",
    "stop_graph",
]


def neighbours(network, stop_id: str, walking: bool = True) -> tuple[str, ...]:
    """Stops a passenger can get to from here without waiting twice.

    That means the next stop of any pattern calling here, and, unless walking is
    switched off, the far end of any declared transfer.
    """
    network.stop(stop_id)
    found: Set[str] = set()
    for pattern_id, index in network.patterns_at(stop_id):
        pattern = network.pattern(pattern_id)
        if index + 1 < len(pattern) and pattern.can_board(index):
            if pattern.can_alight(index + 1):
                found.add(pattern.stops[index + 1])
    if walking:
        for transfer in network.transfers_from(stop_id):
            found.add(transfer.to_stop)
    found.discard(stop_id)
    return tuple(sorted(found))


def stop_graph(network, walking: bool = True) -> Dict[str, Tuple[str, ...]]:
    """Every stop with the stops one hop away from it."""
    return {
        stop.stop_id: neighbours(network, stop.stop_id, walking)
        for stop in network.stops()
        if not stop.is_station
    }


def reachable_stops(
    network, stop_id: str, limit: Optional[int] = None, walking: bool = True
) -> Dict[str, int]:
    """Every stop reachable from here, and how many hops away it is.

    The starting stop is not included, and ``limit`` caps how far the walk
    goes: one hop is the next stop along, two is the one after that.
    """
    if limit is not None and limit < 0:
        raise NetworkError("a reach cannot be %d hops" % limit)
    graph = stop_graph(network, walking)
    if stop_id not in graph:
        network.stop(stop_id)
        return {}
    found: Dict[str, int] = {}
    frontier = [stop_id]
    depth = 0
    seen = {stop_id}
    while frontier and (limit is None or depth < limit):
        depth += 1
        following: List[str] = []
        for current in frontier:
            for neighbour in graph.get(current, ()):
                if neighbour in seen:
                    continue
                seen.add(neighbour)
                found[neighbour] = depth
                following.append(neighbour)
        frontier = sorted(following)
    return found


def hops_between(network, origin: str, destination: str, walking: bool = True) -> Optional[int]:
    """How many hops apart two stops are, or ``None`` if they never connect."""
    if origin == destination:
        return 0
    return reachable_stops(network, origin, None, walking).get(destination)


def components(network, walking: bool = True) -> tuple[tuple[str, ...], ...]:
    """The groups of stops that connect to each other and not to the rest.

    A feed with two components is two networks in one file: no sequence of
    rides and declared walks gets a passenger from one to the other. Direction
    is ignored here, because a one way loop is still one network.
    """
    graph = stop_graph(network, walking)
    undirected: Dict[str, Set[str]] = {stop_id: set() for stop_id in graph}
    for stop_id, others in graph.items():
        for other in others:
            if other not in undirected:
                continue
            undirected[stop_id].add(other)
            undirected[other].add(stop_id)
    seen: Set[str] = set()
    found: List[tuple] = []
    for stop_id in sorted(undirected):
        if stop_id in seen:
            continue
        group: List[str] = []
        frontier = [stop_id]
        seen.add(stop_id)
        while frontier:
            current = frontier.pop()
            group.append(current)
            for neighbour in sorted(undirected[current]):
                if neighbour not in seen:
                    seen.add(neighbour)
                    frontier.append(neighbour)
        found.append(tuple(sorted(group)))
    return tuple(sorted(found, key=lambda group: (-len(group), group[0])))


def is_connected(network, walking: bool = True) -> bool:
    """Whether every stop connects to every other, one way or another."""
    found = components(network, walking)
    return len(found) <= 1


def route_neighbours(network, route_id: str) -> tuple[str, ...]:
    """Routes that call at a stop this one also calls at, sorted."""
    network.route(route_id)
    stops: Set[str] = set()
    for pattern_id in network.patterns_of_route(route_id):
        stops.update(network.pattern(pattern_id).stops)
    found: Set[str] = set()
    for stop_id in stops:
        found.update(network.routes_at(stop_id))
        for sibling in network.siblings_of(stop_id):
            found.update(network.routes_at(sibling))
    found.discard(route_id)
    return tuple(sorted(found))
