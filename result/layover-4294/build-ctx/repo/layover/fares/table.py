"""The fare table: every product, every rule, and the match between them.

Matching is deliberately dull. Rules are sorted once, most specific first, and
the first one that fits wins; a tie in specificity is settled by the cheaper
price and then by the identifier, so two feeds that list the same rules in a
different order price a journey identically.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Tuple

from layover.errors import FareError
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
    ) -> None:
        self._products: Dict[str, FareProduct] = {}
        self._rules: List[FareRule] = []
        self.currency = str(currency).strip().upper()
        for product in products:
            self.add_product(product)
        for rule in rules:
            self.add_rule(rule)
        self._ordered: Optional[Tuple[FareRule, ...]] = None

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
