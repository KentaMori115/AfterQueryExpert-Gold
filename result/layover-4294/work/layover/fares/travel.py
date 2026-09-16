"""Charging a run of travel once the caps a feed declares have been applied.

Pricing answers what tickets cost. This module answers what a passenger is
actually charged, which is not the same thing once a day or a week has a
ceiling on it. Tickets are bought exactly as :func:`layover.fares.price_rides`
buys them, a ticket at a time and in order, and each one is then charged the
least of its own price and whatever is left under every cap that applies to it.

Rides carry the service day they ran on, so a cap counts a tram that leaves at
25:10 against the day before, the same way a board does. Weeks run Monday to
Sunday around that service day. Nothing here reads a clock: hand it the same
travel twice and it charges the same both times.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Dict, Iterable, List, Sequence, Tuple

from layover.dates import format_date
from layover.errors import FareError
from layover.fares.cap import PERIODS, CapTotal, FareCap, period_start
from layover.fares.price import Ride, TicketPurchase, price_rides
from layover.fares.table import FareTable
from layover.fares.zones import ZoneMap
from layover.money import Money, total_of

__all__ = ["TicketCharge", "TravelPrice", "price_travel"]

_Window = Tuple[str, date]


@dataclass(frozen=True)
class TicketCharge:
    """One ticket, the day it was bought on, and what it came to in the end."""

    ticket: TicketPurchase
    day: date
    charged: Money
    caps: tuple[str, ...] = ()

    @property
    def price(self) -> Money:
        """What the ticket would have cost with nothing capping it."""
        return self.ticket.price

    @property
    def saved(self) -> Money:
        """How much of the ticket a cap took off."""
        return self.price - self.charged

    @property
    def capped(self) -> bool:
        """Whether a cap took anything off this ticket at all."""
        return not self.saved.is_zero

    @property
    def free(self) -> bool:
        """Whether the passenger paid nothing for this ticket."""
        return self.charged.is_zero

    def __str__(self) -> str:
        return "%s on %s: %s of %s" % (
            self.ticket.product.fare_id,
            format_date(self.day),
            self.charged,
            self.price,
        )


@dataclass(frozen=True)
class TravelPrice:
    """What a run of travel came to, ticket by ticket and cap by cap."""

    total: Money
    charges: tuple[TicketCharge, ...]
    totals: tuple[CapTotal, ...] = ()

    @property
    def ticket_count(self) -> int:
        """How many tickets the passenger had to buy."""
        return len(self.charges)

    @property
    def full(self) -> Money:
        """What the same tickets would have cost with nothing capping them."""
        return total_of([charge.price for charge in self.charges], self.total.currency)

    @property
    def saved(self) -> Money:
        """How much the caps took off altogether."""
        return self.full - self.total

    @property
    def capped(self) -> bool:
        """Whether a cap took anything off at all."""
        return not self.saved.is_zero

    def tickets(self) -> tuple[TicketPurchase, ...]:
        """Every ticket bought, in the order it was bought."""
        return tuple(charge.ticket for charge in self.charges)

    def days(self) -> tuple[date, ...]:
        """Every service day travelled on, in order."""
        found: List[date] = []
        for charge in self.charges:
            if charge.day not in found:
                found.append(charge.day)
        return tuple(found)

    def charged_on(self, day: date) -> Money:
        """What the passenger paid on one service day."""
        return total_of(
            [charge.charged for charge in self.charges if charge.day == day],
            self.total.currency,
        )

    def caps_used(self) -> tuple[str, ...]:
        """Every cap that applied to any ticket, sorted."""
        found = set()
        for charge in self.charges:
            found.update(charge.caps)
        return tuple(sorted(found))

    def cap_totals(self) -> tuple[CapTotal, ...]:
        """What each cap collected over each of its periods, in period order."""
        return self.totals

    def total_under(self, cap_id: str, day: date) -> Money:
        """What one cap collected over the period a day falls in."""
        for total in self.totals:
            if total.cap_id != cap_id:
                continue
            if total.starts_on == period_start(total.period, day):
                return total.charged
        return Money.zero(self.total.currency)

    def reached(self) -> tuple[str, ...]:
        """Every cap a passenger paid in full, sorted and without repeats."""
        return tuple(sorted({total.cap_id for total in self.totals if total.reached}))

    def describe(self) -> str:
        """One line: the total, how many tickets it took and what caps saved."""
        tickets = "one ticket" if self.ticket_count == 1 else "%d tickets" % self.ticket_count
        if self.saved.is_zero:
            return "%s on %s" % (self.total, tickets)
        return "%s on %s, %s off by caps" % (self.total, tickets, self.saved)

    def __str__(self) -> str:
        return self.describe()


def price_travel(
    rides: Sequence[Ride],
    table: FareTable,
    zones: ZoneMap,
) -> TravelPrice:
    """Charge a run of travel under a fare table, caps and all.

    Every ride has to say which service day it ran on, and the rides come in
    travel order, day first and boarding time second. Tickets are bought one
    service day at a time, so a ticket never spans two of them however wide the
    validity window of its product is.
    """
    if not rides:
        return TravelPrice(Money.zero(table.currency), ())
    if table.is_empty:
        raise FareError("the fare table has no rules to price a journey with")
    charges: List[TicketCharge] = []
    spent: Dict[_Window, Money] = {}
    limits: Dict[_Window, FareCap] = {}
    for day, group in _by_day(_in_order(rides)):
        for ticket in price_rides(group, table, zones).tickets:
            charges.append(_charge(ticket, day, table, zones, spent, limits))
    total = total_of([charge.charged for charge in charges], table.currency)
    return TravelPrice(total, tuple(charges), _totals(spent, limits))


def _totals(spent: Dict[_Window, Money], limits: Dict[_Window, FareCap]) -> tuple[CapTotal, ...]:
    windows = sorted(spent, key=lambda key: (key[1], limits[key].period, key[0]))
    return tuple(
        CapTotal(
            cap_id,
            limits[(cap_id, starts_on)].period,
            starts_on,
            spent[(cap_id, starts_on)],
            limits[(cap_id, starts_on)].price,
        )
        for cap_id, starts_on in windows
    )


def _in_order(rides: Sequence[Ride]) -> tuple[Ride, ...]:
    previous = None
    for ride in rides:
        here = (ride.service_day(), ride.board_time)
        if previous is not None and here < previous:
            raise FareError("travel is charged in order, and %s comes after a later ride" % ride)
        previous = here
    return tuple(rides)


def _by_day(rides: Iterable[Ride]) -> tuple[Tuple[date, tuple[Ride, ...]], ...]:
    days: List[Tuple[date, List[Ride]]] = []
    for ride in rides:
        day = ride.service_day()
        if not days or days[-1][0] != day:
            days.append((day, []))
        days[-1][1].append(ride)
    return tuple((day, tuple(group)) for day, group in days)


def _applying(ticket: TicketPurchase, day: date, table: FareTable, zones: ZoneMap):
    touched = _zones_of(ticket, zones)
    ridden = _routes_of(ticket)
    found: List[Tuple[FareCap, _Window]] = []
    for period in PERIODS:
        cap = table.match_cap(period, touched, ridden)
        if cap is not None:
            found.append((cap, (cap.cap_id, cap.starts_on(day))))
    return found


def _routes_of(ticket: TicketPurchase) -> tuple[str, ...]:
    ridden: List[str] = []
    for ride in ticket.rides:
        if ride.route_id not in ridden:
            ridden.append(ride.route_id)
    return tuple(ridden)


def _zones_of(ticket: TicketPurchase, zones: ZoneMap) -> tuple[str, ...]:
    touched: List[str] = []
    for ride in ticket.rides:
        for stop_id in ride.stops():
            zone = zones.zone_of(stop_id)
            if zone not in touched:
                touched.append(zone)
    return tuple(touched)


def _charge(
    ticket: TicketPurchase,
    day: date,
    table: FareTable,
    zones: ZoneMap,
    spent: Dict[_Window, Money],
    limits: Dict[_Window, FareCap],
) -> TicketCharge:
    nothing = Money.zero(table.currency)
    applying = _applying(ticket, day, table, zones)
    charged = ticket.price
    for cap, key in applying:
        charged = charged.capped_at(cap.price - spent.get(key, nothing))
    if charged.cents < 0:
        charged = nothing
    for cap, key in applying:
        spent[key] = spent.get(key, nothing) + charged
        limits[key] = cap
    return TicketCharge(ticket, day, charged, tuple(sorted(cap.cap_id for cap, _ in applying)))
