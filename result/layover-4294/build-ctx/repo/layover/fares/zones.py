"""Fare zones: which zone a stop sits in, and how many a journey crosses.

Zones come off the stops themselves, because that is where a feed writes them,
and a stop with no zone falls back to the zone of its station. A journey that
leaves the zoned area is not priced by guesswork: the pricing raises instead.
"""

from __future__ import annotations

from typing import Dict, Iterable, Optional

from layover.errors import FareError

__all__ = ["ZoneMap"]


class ZoneMap:
    """Which fare zone each stop belongs to."""

    def __init__(self, zones: Optional[Dict[str, str]] = None) -> None:
        self._zones: Dict[str, str] = {}
        for stop_id, zone in (zones or {}).items():
            self.assign(stop_id, zone)

    def assign(self, stop_id: str, zone: str) -> None:
        """Put a stop in a zone, replacing whatever it had before."""
        identifier = str(stop_id).strip()
        name = str(zone).strip()
        if not identifier:
            raise FareError("a zone assignment needs a stop")
        if not name:
            raise FareError("stop %r cannot be put in an unnamed zone" % identifier)
        self._zones[identifier] = name

    def zone_of(self, stop_id: str) -> str:
        """The zone a stop is in, raising if it has none."""
        try:
            return self._zones[stop_id]
        except KeyError:
            raise FareError("stop %r is not in any fare zone" % (stop_id,)) from None

    def find(self, stop_id: str) -> Optional[str]:
        """The zone a stop is in, or ``None`` if it has none."""
        return self._zones.get(stop_id)

    def __contains__(self, stop_id: object) -> bool:
        return stop_id in self._zones

    def __len__(self) -> int:
        return len(self._zones)

    def zones(self) -> tuple[str, ...]:
        """Every zone named, sorted."""
        return tuple(sorted(set(self._zones.values())))

    def stops_in(self, zone: str) -> tuple[str, ...]:
        """Every stop in one zone, sorted."""
        return tuple(sorted(stop for stop, name in self._zones.items() if name == zone))

    def unzoned(self, stop_ids: Iterable[str]) -> tuple[str, ...]:
        """Which of the given stops have no zone, sorted."""
        return tuple(sorted(stop_id for stop_id in stop_ids if stop_id not in self._zones))

    def counts(self) -> dict:
        """How many stops sit in each zone."""
        found: Dict[str, int] = {}
        for zone in self._zones.values():
            found[zone] = found.get(zone, 0) + 1
        return found

    def __str__(self) -> str:
        return "%d stops in %d zones" % (len(self._zones), len(self.zones()))

    @classmethod
    def of_network(cls, network) -> "ZoneMap":
        """Read the zones off a network, a platform inheriting from its station."""
        found = cls()
        for stop in network.stops():
            zone = stop.zone
            if zone is None and stop.parent is not None:
                zone = network.stop(stop.parent).zone
            if zone is not None:
                found.assign(stop.stop_id, zone)
        return found
