"""Aspect sequencing: what each signal shows given the one in front of it.

The rule is one step less restrictive than the signal ahead, clamped to what the
signal can actually display. A four aspect signal behind a three aspect one can
still show double yellow when the one ahead is at yellow; a three aspect signal
behind a four aspect one cannot, and shows yellow instead. Those clamps are
where read through problems come from, so the table records both what the rule
wanted and what the signal can do.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from ..topology.scheme import Scheme
from .interlocking import Interlocking, RoutePlan
from .route import RouteClass
from .signal import Aspect, Signal
from .warning import WARNING_ASPECT


@dataclass(frozen=True)
class AspectRule:
    """What one signal shows over one route, for each aspect of the one ahead."""

    route: str
    entrance: str
    ahead: str | None
    table: Mapping[Aspect, Aspect]

    @property
    def leads_out_of_the_scheme(self) -> bool:
        return self.ahead is None

    def shown(self, ahead_aspect: Aspect) -> Aspect:
        return self.table[ahead_aspect]

    def best(self) -> Aspect:
        return max(self.table.values(), key=lambda aspect: aspect.value)

    def clamped(self) -> bool:
        """True when the signal cannot show everything the rule asked for."""
        return any(shown is not ahead.less_restrictive() for ahead, shown in self.table.items())

    def __str__(self) -> str:
        ahead = self.ahead or "out of area"
        pairs = ", ".join(
            f"{a}>{b}" for a, b in sorted(self.table.items(), key=lambda p: p[0].value)
        )
        return f"{self.route} behind {ahead}: {pairs}"


def aspect_shown(signal: Signal, ahead: Signal | None, ahead_aspect: Aspect) -> Aspect:
    """One step less restrictive than the signal ahead, within this signal's range."""
    if ahead is None:
        return signal.best_aspect
    return signal.clamp(ahead_aspect.less_restrictive())


def rule_for(scheme: Scheme, plan: RoutePlan) -> AspectRule | None:
    """The aspect rule for one route, or None if the route never clears a signal."""
    if not plan.klass.clears_signal:
        return None
    entrance = scheme.signal(plan.entrance)
    ahead = scheme.signal(plan.exit) if plan.route.exit.is_signal else None

    if plan.klass is RouteClass.WARNING:
        # A warning route gets a single yellow whatever is in front of it.
        table = {aspect: entrance.clamp(WARNING_ASPECT) for aspect in Aspect}
    elif ahead is None:
        table = {aspect: entrance.best_aspect for aspect in Aspect}
    else:
        table = {aspect: aspect_shown(entrance, ahead, aspect) for aspect in ahead.available}

    return AspectRule(plan.name, entrance.name, ahead.name if ahead else None, table)


class AspectChart:
    """Every aspect rule in a scheme, grouped by the signal that shows them."""

    def __init__(self, rules: list[AspectRule]) -> None:
        self.rules = rules
        self._by_signal: dict[str, list[AspectRule]] = {}
        for rule in rules:
            self._by_signal.setdefault(rule.entrance, []).append(rule)

    def __len__(self) -> int:
        return len(self.rules)

    def for_signal(self, name: str) -> list[AspectRule]:
        return list(self._by_signal.get(name, ()))

    def rule(self, route: str) -> AspectRule | None:
        for candidate in self.rules:
            if candidate.route == route:
                return candidate
        return None

    def best_for(self, signal: str) -> Aspect:
        """The best aspect a signal can ever show over any of its routes."""
        rules = self._by_signal.get(signal, ())
        if not rules:
            return Aspect.RED
        return max((rule.best() for rule in rules), key=lambda aspect: aspect.value)

    def clamped_rules(self) -> list[AspectRule]:
        """Rules where the signal cannot show what the sequence asked for."""
        return [rule for rule in self.rules if rule.clamped()]

    def signals_that_never_clear(self, scheme: Scheme) -> list[str]:
        return sorted(
            name
            for name, signal in scheme.signals.items()
            if signal.type.carries_main_routes and name not in self._by_signal
        )


def build_chart(scheme: Scheme, interlocking: Interlocking) -> AspectChart:
    rules = []
    for plan in interlocking.sorted_plans():
        rule = rule_for(scheme, plan)
        if rule is not None:
            rules.append(rule)
    return AspectChart(rules)


def routes_that_clear(interlocking: Interlocking) -> list[RoutePlan]:
    return [plan for plan in interlocking if plan.klass is not RouteClass.SHUNT]
