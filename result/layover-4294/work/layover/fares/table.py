"""The fare table: every product, every rule, every cap, and the matching.

Matching is deliberately dull. Rules are sorted once, most specific first, and
the first one that fits wins; a tie in specificity is settled by the cheaper
price and then by the identifier, so two feeds that list the same rules in a
different order price a journey identically.

Caps are held here too and selected the same way, one period at a time, so a
feed that writes a daily and a weekly ceiling gets one of each and never two.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Tuple

from layover.errors import FareError
from layover.fares.cap import PERIODS, FareCap
from layover.fares.rules import FareProduct, FareRule
from layover.money import Money

__all__ = ["FareTable"]


class FareTable:
    """Fare products and the rules that select them."""

    def __init__(
        self,
        products: Iterable[FareProduct] = (),
        rules: Iterable[FareRule] = (),
        currency: str = "EUR",
        caps: Iterable[FareCap] = (),
    ) -> None:
        self._products: Dict[str, FareProduct] = {}
        self._rules: List[FareRule] = []
        self._caps: Dict[str, FareCap] = {}
        self.currency = str(currency).strip().upper()
        for product in products:
            self.add_product(product)
        for rule in rules:
            self.add_rule(rule)
        for cap in caps:
            self.add_cap(cap)
        self._ordered: Optional[Tuple[FareRule, ...]] = None
        self._ordered_caps: Dict[str, Tuple[FareCap, ...]] = {}

    def add_product(self, product: FareProduct) -> None:
        """Take on one product, refusing an identifier that is already used."""
        if product.fare_id in self._products:
            raise FareError("fare product %r is defined twice" % product.fare_id)
        if product.price.currency != self.currency:
            raise FareError(
                "fare %r is priced in %s but the table is in %s"
                % (product.fare_id, product.price.currency, self.currency)
            )
        self._products[product.fare_id] = product
        self._ordered = None

    def add_rule(self, rule: FareRule) -> None:
        """Take on one rule, refusing a product that does not exist."""
        if rule.fare_id not in self._products:
            raise FareError("fare rule names unknown product %r" % rule.fare_id)
        self._rules.append(rule)
        self._ordered = None

    def add_cap(self, cap: FareCap) -> None:
        """Take on one cap, refusing a repeated identifier or a foreign currency."""
        if cap.cap_id in self._caps:
            raise FareError("fare cap %r is defined twice" % cap.cap_id)
        if cap.price.currency != self.currency:
            raise FareError(
                "cap %r is priced in %s but the table is in %s"
                % (cap.cap_id, cap.price.currency, self.currency)
            )
        self._caps[cap.cap_id] = cap
        self._ordered_caps = {}

    def cap(self, cap_id: str) -> FareCap:
        """Return one cap, raising if the identifier is unknown."""
        try:
            return self._caps[cap_id]
        except KeyError:
            raise FareError("no such fare cap: %r" % (cap_id,)) from None

    def caps(self) -> tuple[FareCap, ...]:
        """Every cap, in identifier order."""
        return tuple(self._caps[cap_id] for cap_id in sorted(self._caps))

    @property
    def has_caps(self) -> bool:
        """Whether anything in the table limits what a passenger is charged."""
        return bool(self._caps)

    def ordered_caps(self, period: str) -> tuple[FareCap, ...]:
        """One period's caps, sorted the way matching walks them."""
        if period not in PERIODS:
            raise FareError("a cap period is one of %s, got %r" % (", ".join(PERIODS), period))
        if period not in self._ordered_caps:
            self._ordered_caps[period] = tuple(
                sorted(
                    (cap for cap in self._caps.values() if cap.period == period),
                    key=lambda cap: (-cap.specificity, cap.price.cents, cap.cap_id),
                )
            )
        return self._ordered_caps[period]

    def match_cap(
        self,
        period: str,
        zones: Iterable[str],
        routes: Iterable[str] = (),
    ) -> Optional[FareCap]:
        """The cap of one period that limits travel over these zones and routes."""
        touched = tuple(zones)
        ridden = tuple(routes)
        for cap in self.ordered_caps(period):
            if cap.covers(touched, ridden):
                return cap
        return None

    def cap_zones(self) -> tuple[str, ...]:
        """Every zone any cap mentions, sorted."""
        return tuple(sorted({cap.zone for cap in self._caps.values() if cap.zone is not None}))

    def cap_routes(self) -> tuple[str, ...]:
        """Every route any cap mentions, sorted."""
        return tuple(
            sorted({cap.route_id for cap in self._caps.values() if cap.route_id is not None})
        )

    def product(self, fare_id: str) -> FareProduct:
        """Return one product, raising if the identifier is unknown."""
        try:
            return self._products[fare_id]
        except KeyError:
            raise FareError("no such fare product: %r" % (fare_id,)) from None

    def products(self) -> tuple[FareProduct, ...]:
        """Every product, in identifier order."""
        return tuple(self._products[fare_id] for fare_id in sorted(self._products))

    def rules(self) -> tuple[FareRule, ...]:
        """Every rule, in the order it was added."""
        return tuple(self._rules)

    def __len__(self) -> int:
        return len(self._products)

    @property
    def is_empty(self) -> bool:
        """Whether the table can price anything at all."""
        return not self._products or not self._rules

    def ordered_rules(self) -> tuple[FareRule, ...]:
        """Rules sorted the way matching walks them: most specific, then cheapest."""
        if self._ordered is None:
            self._ordered = tuple(
                sorted(
                    self._rules,
                    key=lambda rule: (
                        -rule.specificity,
                        self._products[rule.fare_id].price.cents,
                        rule.fare_id,
                    ),
                )
            )
        return self._ordered

    def match(self, from_zone: str, to_zone: str, route_id: str) -> Optional[FareProduct]:
        """The product a ride is sold under, or ``None`` if no rule fits."""
        for rule in self.ordered_rules():
            if rule.matches(from_zone, to_zone, route_id):
                return self._products[rule.fare_id]
        return None

    def price_of(self, from_zone: str, to_zone: str, route_id: str) -> Money:
        """What a ride costs, raising if nothing in the table covers it."""
        product = self.match(from_zone, to_zone, route_id)
        if product is None:
            raise FareError(
                "no fare covers %s to %s on route %r" % (from_zone, to_zone, route_id)
            )
        return product.price

    def cheapest(self) -> Optional[FareProduct]:
        """The cheapest product in the table, or ``None`` if there is none."""
        if not self._products:
            return None
        return min(self.products(), key=lambda product: (product.price.cents, product.fare_id))

    def dearest(self) -> Optional[FareProduct]:
        """The dearest product in the table, or ``None`` if there is none."""
        if not self._products:
            return None
        return max(self.products(), key=lambda product: (product.price.cents, product.fare_id))

    def unused_products(self) -> tuple[str, ...]:
        """Products no rule ever selects, sorted."""
        used = {rule.fare_id for rule in self._rules}
        return tuple(sorted(set(self._products) - used))

    def zones_named(self) -> tuple[str, ...]:
        """Every zone any rule mentions, sorted."""
        zones = set()
        for rule in self._rules:
            zones.update(zone for zone in (rule.from_zone, rule.to_zone) if zone is not None)
        return tuple(sorted(zones))

    def __str__(self) -> str:
        return "%d fares, %d rules" % (len(self._products), len(self._rules))

    @classmethod
    def flat(cls, price, fare_id: str = "flat", transfers: Optional[int] = None) -> "FareTable":
        """Build a table with one price that applies everywhere."""
        product = FareProduct(fare_id, Money(price) if not isinstance(price, Money) else price, transfers)
        return cls([product], [FareRule(fare_id)], product.price.currency)
