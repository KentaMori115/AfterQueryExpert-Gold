"""Fare amounts, exact to the minor unit and never a float.

Prices are added up over the legs of a journey and compared against caps and
allowances, so binary floating point is not good enough: a fare of 2.40 has to
stay 2.40 after three additions. Everything here is :class:`~decimal.Decimal`
under a fixed currency, and mixing currencies raises rather than guessing.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Iterable, Optional

from layover.errors import FareError, Location

__all__ = [
    "CENT",
    "Money",
    "parse_amount",
    "total_of",
]

CENT = Decimal("0.01")


def parse_amount(text, where: Optional[Location] = None) -> Decimal:
    """Read an amount into a decimal, refusing floats and rounding to the cent."""
    if isinstance(text, float):
        raise FareError("an amount must not be a float, got %r" % (text,), where)
    if isinstance(text, Decimal):
        value = text
    elif isinstance(text, int):
        value = Decimal(text)
    elif isinstance(text, str):
        cleaned = text.strip()
        if not cleaned:
            raise FareError("an amount cannot be empty", where)
        try:
            value = Decimal(cleaned)
        except InvalidOperation:
            raise FareError("cannot read %r as an amount" % text, where) from None
    else:
        raise FareError("cannot read %r as an amount" % (text,), where)
    if not value.is_finite():
        raise FareError("an amount has to be finite, got %r" % (text,), where)
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Money:
    """An amount in one currency, held to the cent.

    Ordering compares the amount first, so a sorted list of prices in one
    currency reads the way a passenger would expect. Comparing across
    currencies raises instead of ordering by the currency code.
    """

    amount: Decimal
    currency: str = "EUR"

    def __post_init__(self) -> None:
        object.__setattr__(self, "amount", parse_amount(self.amount))
        code = str(self.currency).strip().upper()
        if len(code) != 3 or not code.isalpha():
            raise FareError("a currency is three letters, got %r" % (self.currency,))
        object.__setattr__(self, "currency", code)

    def _same(self, other: "Money") -> None:
        if not isinstance(other, Money):
            raise FareError("cannot mix money with %r" % (other,))
        if other.currency != self.currency:
            raise FareError("cannot mix %s with %s" % (self.currency, other.currency))

    def __add__(self, other: "Money") -> "Money":
        self._same(other)
        return Money(self.amount + other.amount, self.currency)

    def __sub__(self, other: "Money") -> "Money":
        self._same(other)
        return Money(self.amount - other.amount, self.currency)

    def __mul__(self, count: int) -> "Money":
        if not isinstance(count, int) or isinstance(count, bool):
            raise FareError("money multiplies by a whole number, got %r" % (count,))
        return Money(self.amount * count, self.currency)

    def __neg__(self) -> "Money":
        return Money(-self.amount, self.currency)

    def __lt__(self, other: "Money") -> bool:
        self._same(other)
        return self.amount < other.amount

    def __le__(self, other: "Money") -> bool:
        self._same(other)
        return self.amount <= other.amount

    def __gt__(self, other: "Money") -> bool:
        self._same(other)
        return self.amount > other.amount

    def __ge__(self, other: "Money") -> bool:
        self._same(other)
        return self.amount >= other.amount

    def __str__(self) -> str:
        return "%s %s" % (self.amount, self.currency)

    @property
    def cents(self) -> int:
        """The amount as a whole number of minor units."""
        return int(self.amount.scaleb(2))

    @property
    def is_zero(self) -> bool:
        """Whether the amount is exactly nothing."""
        return self.amount == 0

    def capped_at(self, ceiling: "Money") -> "Money":
        """Return this amount, or ``ceiling`` if it is smaller."""
        self._same(ceiling)
        return ceiling if ceiling.amount < self.amount else self

    def share(self, parts: int) -> tuple["Money", ...]:
        """Split the amount into ``parts``, the remainder going to the first ones."""
        if not isinstance(parts, int) or parts < 1:
            raise FareError("money splits into a positive number of parts, got %r" % (parts,))
        total = self.cents
        base, extra = divmod(total, parts)
        out = []
        for index in range(parts):
            cents = base + (1 if index < extra else 0)
            out.append(Money(Decimal(cents).scaleb(-2), self.currency))
        return tuple(out)

    @classmethod
    def zero(cls, currency: str = "EUR") -> "Money":
        """Return nothing in the given currency."""
        return cls(Decimal("0"), currency)

    @classmethod
    def parse(cls, text: str, where: Optional[Location] = None) -> "Money":
        """Read ``"2.40 EUR"`` or a bare ``"2.40"`` into money."""
        cleaned = str(text).strip()
        parts = cleaned.split()
        if len(parts) == 2:
            return cls(parse_amount(parts[0], where), parts[1])
        if len(parts) == 1:
            return cls(parse_amount(parts[0], where))
        raise FareError("cannot read %r as money" % (text,), where)


def total_of(amounts: Iterable[Money], currency: str = "EUR") -> Money:
    """Add up money, giving zero in ``currency`` when there is none to add."""
    total: Optional[Money] = None
    for amount in amounts:
        total = amount if total is None else total + amount
    return Money.zero(currency) if total is None else total
