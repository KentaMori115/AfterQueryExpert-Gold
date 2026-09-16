"""The network model: stops, routes, patterns, trips and transfers.

Build one with :class:`NetworkBuilder`, read it through :class:`Network`. Nothing
here knows about dates or searching; a network is the shape of the system and
the times on it, and the service calendars say which of those trips run today.
"""

from __future__ import annotations

from layover.network.builder import NetworkBuilder
from layover.network.graph import (
    components,
    hops_between,
    is_connected,
    neighbours,
    reachable_stops,
    route_neighbours,
    stop_graph,
)
from layover.network.network import Network
from layover.network.patterns import Pattern
from layover.network.routes import Agency, Mode, Route
from layover.network.stops import Stop, StopKind
from layover.network.transfers import Transfer, TransferKind, closure
from layover.network.trips import StopCall, Trip

__all__ = [
    "Agency",
    "Mode",
    "Network",
    "NetworkBuilder",
    "Pattern",
    "Route",
    "Stop",
    "StopCall",
    "StopKind",
    "Transfer",
    "TransferKind",
    "Trip",
    "closure",
    "components",
    "hops_between",
    "is_connected",
    "neighbours",
    "reachable_stops",
    "route_neighbours",
    "stop_graph",
]
