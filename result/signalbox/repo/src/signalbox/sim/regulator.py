"""Deciding who goes first when two trains want the same junction.

Automatic route setting on its own asks for routes in whatever order the trains
happen to be listed, which is not regulation, it is luck. The regulator puts an
order on the requests: the train that has been waiting longest goes first,
unless something faster is close enough behind to be worth holding the slower
one for, which is what a signaller would do.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..units import Distance


class Class(Enum):
    """What sort of train it is, worst first for regulating purposes."""

    FREIGHT = 1
    STOPPER = 2
    EXPRESS = 3

    @property
    def keeps_moving(self) -> bool:
        """Whether stopping this train costs a lot to get going again."""
        return self is not Class.STOPPER

    @classmethod
    def from_word(cls, word: str) -> Class | None:
        for member in cls:
            if member.name.lower() == word.lower():
                return member
        return None

    def __str__(self) -> str:
        return self.name.lower()


#: How long a train has to have been waiting before it goes ahead of a faster one.
PATIENCE = 180.0

#: A faster train further away than this is not worth holding anybody for.
CLOSE_ENOUGH = Distance(2000.0)


@dataclass(frozen=True)
class Candidate:
    """One train wanting one route, and what is known about it."""

    train: str
    route: str
    klass: Class = Class.STOPPER
    waiting: float = 0.0
    distance: Distance = Distance(0.0)

    @property
    def impatient(self) -> bool:
        return self.waiting >= PATIENCE

    @property
    def close(self) -> bool:
        return self.distance.metres <= CLOSE_ENOUGH.metres

    def __str__(self) -> str:
        return f"{self.train} for {self.route} ({self.klass}, waiting {self.waiting:.0f}s)"


@dataclass
class Regulator:
    """The order requests are put in."""

    patience: float = PATIENCE
    reach: Distance = CLOSE_ENOUGH

    def rank(self, candidate: Candidate) -> tuple[int, float, float, str]:
        """The sort key: lower comes first."""
        waited_long_enough = candidate.waiting >= self.patience
        worth_holding_for = (
            candidate.klass is Class.EXPRESS and candidate.distance.metres <= self.reach.metres
        )
        first = 0 if (waited_long_enough or worth_holding_for) else 1
        return (first, -candidate.waiting, candidate.distance.metres, candidate.train)

    def order(self, candidates: list[Candidate]) -> list[Candidate]:
        """Put the requests in the order they should be asked for."""
        return sorted(candidates, key=self.rank)

    def first(self, candidates: list[Candidate]) -> Candidate | None:
        ordered = self.order(candidates)
        return ordered[0] if ordered else None

    def describe(self, candidates: list[Candidate]) -> str:
        ordered = self.order(candidates)
        if not ordered:
            return "nothing waiting"
        return " then ".join(candidate.train for candidate in ordered)
