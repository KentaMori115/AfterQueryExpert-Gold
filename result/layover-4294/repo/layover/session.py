"""The façade: one object that holds a feed and answers questions about it.

Everything below can be used on its own, and the tests use it that way. This is
the short path: point a session at a feed, a document or the demo, and ask it
for a board, a journey, a price or a report.
"""

from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

from layover.document.store import document_digest, load_document, save_document
from layover.document.write import to_document
from layover.errors import PlanError
from layover.fares.price import FarePrice, Ride, price_rides
from layover.fares.zones import ZoneMap
from layover.feed.load import FeedContents, load_feed
from layover.feed.reader import read_directory
from layover.plan.criteria import SearchOptions
from layover.plan.leg import Journey
from layover.plan.profile import plan_profile
from layover.plan.scan import JourneySearch
from layover.report.board import arrival_board, departure_board, stop_summary
from layover.report.diagram import diagram_report, route_diagrams
from layover.report.frequency import (
    frequency_report,
    profile_report,
    route_frequency_report,
)
from layover.report.journey import itinerary_report, journeys_report
from layover.report.render import Report
from layover.report.summary import (
    calendar_report,
    network_report,
    route_report_lines,
    service_day_report,
)
from layover.report.timetable import pattern_report, route_report
from layover.timetable.table import Timetable
from layover.times import TimeWindow
from layover.validate.run import Findings, validate

__all__ = ["Session"]


class Session:
    """A loaded feed, ready to be asked about boards, journeys and fares."""

    def __init__(
        self,
        contents: FeedContents,
        options: Optional[SearchOptions] = None,
        days_back: int = 1,
    ) -> None:
        self.contents = contents
        self.options = options or SearchOptions()
        self.timetable = Timetable(contents.network, contents.services, days_back)
        self._search = JourneySearch(self.timetable, self.options)
        self._zones: Optional[ZoneMap] = None

    @property
    def network(self):
        """The network the feed described."""
        return self.contents.network

    @property
    def services(self):
        """The service calendars."""
        return self.contents.services

    @property
    def fares(self):
        """The fare table, or ``None`` if the feed had none."""
        return self.contents.fares

    @property
    def name(self) -> str:
        """What the feed calls itself."""
        return self.contents.name or self.network.name

    def zones(self) -> ZoneMap:
        """The fare zones, worked out once."""
        if self._zones is None:
            self._zones = self.contents.zones()
        return self._zones

    def with_options(self, options: SearchOptions) -> "Session":
        """Return a session over the same feed with different search settings."""
        return Session(self.contents, options, self.timetable.days_back)

    def departures(self, stop_id: str, day: date, after: int = 0, limit: Optional[int] = 10):
        """The next departures from a stop."""
        return self.timetable.departures(stop_id, day, after, limit)

    def arrivals(self, stop_id: str, day: date, after: int = 0, limit: Optional[int] = 10):
        """The next arrivals at a stop."""
        return self.timetable.arrivals(stop_id, day, after, limit)

    def board(
        self,
        stop_id: str,
        day: date,
        after: int = 0,
        limit: Optional[int] = 10,
        routes: Optional[Iterable[str]] = None,
    ) -> Report:
        """A departure board as a report."""
        return departure_board(self.timetable, stop_id, day, after, limit, routes)

    def arrival_board(
        self, stop_id: str, day: date, after: int = 0, limit: Optional[int] = 10
    ) -> Report:
        """An arrival board as a report."""
        return arrival_board(self.timetable, stop_id, day, after, limit)

    def plan(
        self, origin: str, destination: str, day: date, after: int = 0
    ) -> tuple[Journey, ...]:
        """Journeys from one stop to another, leaving at or after a time."""
        return self._search.plan(origin, destination, day, after)

    def plan_window(
        self, origin: str, destination: str, day: date, window: TimeWindow, limit: int = 10
    ) -> tuple[Journey, ...]:
        """Every journey worth catching inside a window."""
        return plan_profile(self.timetable, origin, destination, day, window, self.options, limit)

    def reachable(self, origin: str, day: date, after: int = 0) -> dict:
        """The earliest arrival at every stop reachable from one."""
        return self._search.reachable(origin, day, after)

    def price(self, journey: Journey) -> FarePrice:
        """What a journey costs, raising if the feed has no fares."""
        if self.fares is None:
            raise PlanError("this feed has no fares")
        rides = [
            Ride(leg.route_id, leg.from_stop, leg.to_stop, leg.departure, leg.arrival)
            for leg in journey.rides
        ]
        return price_rides(rides, self.fares, self.zones())

    def itinerary(self, journey: Journey, priced: bool = False) -> Report:
        """One journey written out as a report."""
        price = self.price(journey) if priced and self.fares is not None else None
        return itinerary_report(journey, self.network, price)

    def journeys_report(self, journeys: Iterable[Journey]) -> Report:
        """Several journeys as a list of options."""
        return journeys_report(journeys, self.network)

    def pattern_timetable(
        self, pattern_id: str, day: date, window: Optional[TimeWindow] = None
    ) -> Report:
        """The printed timetable of one pattern."""
        return pattern_report(self.timetable, pattern_id, day, window)

    def route_timetable(
        self, route_id: str, day: date, window: Optional[TimeWindow] = None
    ) -> tuple[Report, ...]:
        """The printed timetable of a route, one report per pattern."""
        return route_report(self.timetable, route_id, day, window)

    def diagram(self, pattern_id: str) -> Report:
        """The line diagram of one pattern."""
        return diagram_report(self.network, pattern_id)

    def route_diagram(self, route_id: str) -> tuple[Report, ...]:
        """A line diagram for each pattern of a route."""
        return route_diagrams(self.network, route_id)

    def routes(self, day: date) -> Report:
        """Every route with its patterns and how many trips run."""
        return route_report_lines(self.timetable, day)

    def stops(self, day: date) -> Report:
        """Every stop with its calls and the routes that serve it."""
        return stop_summary(self.timetable, day)

    def frequency(self, day: date, window: TimeWindow) -> Report:
        """How often something leaves each stop inside a window."""
        return frequency_report(self.timetable, day, window)

    def route_frequency(self, day: date, window: TimeWindow) -> Report:
        """How often each route sets off inside a window."""
        return route_frequency_report(self.timetable, day, window)

    def profile(self, stop_id: str, day: date, step: int = 3600) -> Report:
        """One row per slice of the day at one stop."""
        return profile_report(self.timetable, stop_id, day, step)

    def calendars(self) -> Report:
        """Every service calendar written out."""
        return calendar_report(self.timetable)

    def service_day(self, day: date) -> Report:
        """What runs on one date, route by route."""
        return service_day_report(self.timetable, day)

    def summary(self) -> Report:
        """What the feed holds, counted up."""
        return network_report(self.timetable)

    def check(self, only=None, skip=None) -> Findings:
        """Run the feed checks."""
        return validate(self.contents, only, skip)

    def document(self) -> dict:
        """The feed as a saveable document."""
        return to_document(self.contents)

    def digest(self) -> str:
        """A fingerprint of everything the feed holds."""
        return document_digest(self.contents)

    def save(self, path: str) -> str:
        """Write the feed out as one document."""
        return save_document(self.contents, path)

    def __str__(self) -> str:
        return "%s: %s" % (self.name or "session", self.contents.summary())

    @classmethod
    def from_feed(cls, directory: str, **settings) -> "Session":
        """Open a session on a feed directory."""
        return cls(load_feed(read_directory(directory)), **settings)

    @classmethod
    def from_document(cls, path: str, **settings) -> "Session":
        """Open a session on a saved document."""
        return cls(load_document(path), **settings)

    @classmethod
    def demo(cls, **settings) -> "Session":
        """Open a session on the worked example network."""
        from layover.demo.city import demo_contents

        return cls(demo_contents(), **settings)
