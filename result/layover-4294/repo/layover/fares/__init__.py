"""Fares: zones, products, the rules that pick one, and what a journey costs.

Nothing in here knows what a journey is. Pricing takes a sequence of rides, so
the same code prices a planned journey, a list read off a ticket machine and a
hand written example in a test.
"""

from __future__ import annotations

from layover.fares.price import FarePrice, Ride, TicketPurchase, price_rides
from layover.fares.rules import FareProduct, FareRule
from layover.fares.table import FareTable
from layover.fares.zones import ZoneMap

__all__ = [
    "FarePrice",
    "FareProduct",
    "FareRule",
    "FareTable",
    "Ride",
    "TicketPurchase",
    "ZoneMap",
    "price_rides",
]
