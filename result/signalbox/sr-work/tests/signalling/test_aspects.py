import pytest

from signalbox.signalling.aspects import (
    AspectRule,
    aspect_shown,
    build_chart,
    routes_that_clear,
    rule_for,
)
from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.signal import Aspect


@pytest.fixture
def lock(kingsmoor):
    return build_interlocking(kingsmoor)


@pytest.fixture
def chart(kingsmoor, lock):
    return build_chart(kingsmoor, lock)


def test_a_signal_shows_one_step_better_than_the_one_ahead(kingsmoor):
    k1 = kingsmoor.signal("K1")
    k3 = kingsmoor.signal("K3")
    assert aspect_shown(k1, k3, Aspect.RED) is Aspect.YELLOW
    assert aspect_shown(k1, k3, Aspect.YELLOW) is Aspect.DOUBLE_YELLOW
    assert aspect_shown(k1, k3, Aspect.GREEN) is Aspect.GREEN


def test_a_three_aspect_signal_cannot_show_double_yellow(kingsmoor):
    k3 = kingsmoor.signal("K3")
    k5 = kingsmoor.signal("K5")
    assert aspect_shown(k3, k5, Aspect.YELLOW) is Aspect.YELLOW


def test_a_signal_reading_out_of_the_area_shows_its_best(kingsmoor):
    k5 = kingsmoor.signal("K5")
    assert aspect_shown(k5, None, Aspect.RED) is Aspect.GREEN


def test_the_rule_for_a_route_covers_every_aspect_ahead(kingsmoor, lock):
    rule = rule_for(kingsmoor, lock.plan("K1(M)"))
    assert rule.ahead == "K3"
    assert rule.shown(Aspect.RED) is Aspect.YELLOW
    assert rule.best() is Aspect.GREEN
    assert not rule.leads_out_of_the_scheme


def test_a_route_out_of_the_area_has_no_signal_ahead(kingsmoor, lock):
    rule = rule_for(kingsmoor, lock.plan("K5(M)"))
    assert rule.leads_out_of_the_scheme
    assert rule.shown(Aspect.RED) is Aspect.GREEN


def test_shunt_routes_have_no_aspect_rule(kingsmoor, lock):
    assert rule_for(kingsmoor, lock.plan("K20(S)")) is None


def test_the_chart_groups_rules_by_signal(chart):
    assert [rule.route for rule in chart.for_signal("K3")] == ["K3(MA)", "K3(MB)"]
    assert chart.for_signal("K99") == []


def test_a_rule_can_be_looked_up_by_route(chart):
    assert chart.rule("K1(M)").entrance == "K1"
    assert chart.rule("K99(M)") is None


def test_the_best_a_signal_can_show(chart):
    assert chart.best_for("K1") is Aspect.GREEN
    assert chart.best_for("K99") is Aspect.RED


def test_clamped_rules_are_the_read_through_problems(chart):
    clamped = {rule.route for rule in chart.clamped_rules()}
    assert "K3(MA)" in clamped


def test_signals_with_no_route_never_clear(kingsmoor, chart):
    assert chart.signals_that_never_clear(kingsmoor) == []


def test_shunt_routes_are_left_out_of_the_clearing_set(lock):
    names = {plan.name for plan in routes_that_clear(lock)}
    assert "K20(S)" not in names
    assert "K1(M)" in names


def test_rules_print_their_table():
    rule = AspectRule(
        "K1(M)", "K1", "K3", {Aspect.RED: Aspect.YELLOW, Aspect.GREEN: Aspect.GREEN}
    )
    assert str(rule) == "K1(M) behind K3: R>Y, G>G"
    assert str(AspectRule("K5(M)", "K5", None, {Aspect.RED: Aspect.GREEN})).startswith(
        "K5(M) behind out of area"
    )


def test_the_whole_chart_has_a_rule_for_every_clearing_route(chart, lock):
    assert len(chart) == len([p for p in lock if p.klass.clears_signal])
