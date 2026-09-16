"""Itineraries: a journey written out the way a passenger reads it."""

from __future__ import annotations

from typing import Iterable, Optional

from layover.fares.price import FarePrice
from layover.plan.leg import Journey
from layover.report.render import Report
from layover.times import format_duration, format_short

__all__ = ["arrive_by_report", "itinerary_report", "journeys_report"]


def itinerary_report(
    journey: Journey,
    network=None,
    price: Optional[FarePrice] = None,
) -> Report:
    """One journey, a row per leg, with the change times shown between them."""
    rows = []
    previous_arrival = None
    for leg in journey:
        if previous_arrival is not None and leg.departure > previous_arrival:
            rows.append(
                ("", "wait", format_duration(leg.departure - previous_arrival), "", "")
            )
        rows.append(
            (
                format_short(leg.departure),
                "walk" if leg.is_walk else _route_name(network, leg.route_id),
                format_duration(leg.duration),
                _stop_name(network, leg.from_stop),
                _stop_name(network, leg.to_stop),
            )
        )
        previous_arrival = leg.arrival
    notes = [
        "Arrives %s after %s." % (format_short(journey.arrival), format_duration(journey.duration)),
        "%d changes, %s walking." % (journey.transfers, format_duration(journey.walk_seconds)),
    ]
    if price is not None:
        notes.append("Fare %s." % price.describe())
    return Report(
        "%s to %s, %s"
        % (
            _stop_name(network, journey.origin),
            _stop_name(network, journey.destination),
            format_short(journey.departure),
        ),
        ("Time", "Service", "Takes", "From", "To"),
        tuple(rows),
        tuple(notes),
    )


def journeys_report(journeys: Iterable[Journey], network=None) -> Report:
    """Several journeys, one row each, the way a list of options reads."""
    rows = []
    for journey in journeys:
        rows.append(
            (
                format_short(journey.departure),
                format_short(journey.arrival),
                format_duration(journey.duration),
                str(journey.transfers),
                " ".join(_route_name(network, route) for route in journey.routes()) or "walk",
            )
        )
    notes = () if rows else ("No journey was found.",)
    return Report(
        "Journeys",
        ("Leaves", "Arrives", "Takes", "Changes", "Using"),
        tuple(rows),
        notes,
        right=(3,),
    )


def arrive_by_report(journeys: Iterable[Journey], network=None, by: Optional[int] = None) -> Report:
    """Journeys against a deadline, with the time each one leaves to spare.

    The same rows :func:`journeys_report` writes, in the same order, with one
    column added: how long after the journey arrives the deadline falls. A
    passenger choosing between two ways of being somewhere on time reads that
    column and nothing else.
    """
    rows = []
    for journey in journeys:
        rows.append(
            (
                format_short(journey.departure),
                format_short(journey.arrival),
                format_duration(journey.duration),
                str(journey.transfers),
                format_duration(by - journey.arrival) if by is not None else "",
                " ".join(_route_name(network, route) for route in journey.routes()) or "walk",
            )
        )
    notes = () if rows else ("No journey was found.",)
    title = "Arriving by %s" % format_short(by) if by is not None else "Journeys"
    return Report(
        title,
        ("Leaves", "Arrives", "Takes", "Changes", "Spare", "Using"),
        tuple(rows),
        notes,
        right=(3,),
    )


def _route_name(network, route_id) -> str:
    if network is None or route_id is None:
        return str(route_id or "")
    return network.route(route_id).name


def _stop_name(network, stop_id) -> str:
    if network is None:
        return stop_id
    return network.stop(stop_id).name
