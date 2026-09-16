"""The rule registry and the context every rule is handed.

Rules register themselves by importing, which keeps the list of what runs in one
place instead of scattered across a command line parser.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from functools import cached_property
from typing import TypeVar

from ..signalling.aspects import AspectChart, build_chart
from ..signalling.braking import BrakingModel
from ..signalling.conflict import ConflictMatrix, build_matrix
from ..signalling.interlocking import Interlocking, RoutePlan, build_interlocking
from ..signalling.locking import LockingTable, build_locking
from ..topology.scheme import Scheme
from ..units import Distance
from .report import Finding, Report, Severity


@dataclass
class Context:
    """Everything a rule is allowed to look at.

    The braking model and the overlap length come from the scheme's own design
    standards, so that a rule reports what the scheme fails against rather than
    what this package would have chosen.
    """

    scheme: Scheme
    interlocking: Interlocking
    braking: BrakingModel | None = None
    standard_overlap: Distance | None = None

    def __post_init__(self) -> None:
        if self.braking is None:
            self.braking = BrakingModel(
                rate=self.scheme.standards.braking,
                reaction=self.scheme.standards.reaction,
            )
        if self.standard_overlap is None:
            self.standard_overlap = self.scheme.standards.overlap

    @classmethod
    def build(cls, scheme: Scheme, **kwargs: object) -> Context:
        return cls(scheme=scheme, interlocking=build_interlocking(scheme), **kwargs)  # type: ignore[arg-type]

    @cached_property
    def matrix(self) -> ConflictMatrix:
        return build_matrix(self.interlocking)

    @cached_property
    def locking(self) -> LockingTable:
        return build_locking(self.interlocking, self.matrix)

    @cached_property
    def chart(self) -> AspectChart:
        return build_chart(self.scheme, self.interlocking)

    def plans(self) -> list[RoutePlan]:
        return self.interlocking.sorted_plans()


RuleFunction = Callable[[Context], Iterable[Finding]]

#: Bound to the decorated function so that the decorator does not erase its type.
Function = TypeVar("Function", bound=RuleFunction)


@dataclass(frozen=True)
class Rule:
    """One registered check."""

    code: str
    title: str
    severity: Severity
    run: RuleFunction

    def __call__(self, context: Context) -> list[Finding]:
        return list(self.run(context))

    def __str__(self) -> str:
        return f"{self.code}: {self.title}"


_REGISTRY: dict[str, Rule] = {}


def rule(
    code: str, title: str, severity: Severity = Severity.ERROR
) -> Callable[[Function], Function]:
    """Register a rule under ``code``.

    The decorator hands the function straight back, so a rule can still be
    called directly in a test without going through the registry.
    """

    def decorate(function: Function) -> Function:
        if code in _REGISTRY:
            raise KeyError(f"rule {code} is registered twice")
        _REGISTRY[code] = Rule(code, title, severity, function)
        return function

    return decorate


def registered() -> list[Rule]:
    """Every rule, in the order their codes sort."""
    return [_REGISTRY[code] for code in sorted(_REGISTRY)]


def find(code: str) -> Rule:
    try:
        return _REGISTRY[code]
    except KeyError:
        raise KeyError(f"no rule called {code}") from None


def run(
    context: Context,
    *,
    only: Sequence[str] | None = None,
    skip: Sequence[str] = (),
) -> Report:
    """Run the rules against a context and collect what they say."""
    chosen = [find(code) for code in only] if only else registered()
    chosen = [rule for rule in chosen if rule.code not in skip]

    report = Report(ran=tuple(rule.code for rule in chosen))
    for check in chosen:
        report.extend(check(context))
    return report
