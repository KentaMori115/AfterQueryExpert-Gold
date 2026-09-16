"""Fares: zones, products, the rules that pick one, and what travel costs.

Nothing in here knows what a journey is. Pricing takes a sequence of rides, so
the same code prices a planned journey, a list read off a ticket machine and a
hand written example in a test.

A cap sits above all of that. It sells nothing and it selects nothing; it only
says how much of what the tickets cost is charged over one service day or one
week, which is why charging a run of travel is its own function rather than an
argument to pricing.
"""

from __future__ import annotations

from layover.fares.cap import PERIODS, CapTotal, FareCap, period_start
from layover.fares.price import FarePrice, Ride, TicketPurchase, price_rides
from layover.fares.rules import FareProduct, FareRule
from layover.fares.table import FareTable
from layover.fares.travel import TicketCharge, TravelPrice, price_travel
from layover.fares.zones import ZoneMap

__all__ = [
    "CapTotal",
    "FareCap",
    "FarePrice",
    "FareProduct",
    "FareRule",
    "FareTable",
    "PERIODS",
    "Ride",
    "TicketCharge",
    "TicketPurchase",
    "TravelPrice",
    "ZoneMap",
    "period_start",
    "price_rides",
    "price_travel",
]
