import pytest

from signalbox.sim.log import Event, EventKind, EventLog


@pytest.fixture
def log():
    log = EventLog()
    log.add(0.0, EventKind.TRAIN, "1A05", "enters at D1->100m")
    log.add(12.0, EventKind.ROUTE, "K1(M)", "requested, accepted")
    log.add(18.0, EventKind.SIGNAL, "K1", "clears to Y")
    log.add(40.0, EventKind.TRAIN, "1A05", "passes K1")
    return log


def test_an_empty_log_is_falsy():
    log = EventLog()
    assert not log
    assert len(log) == 0
    assert log.last() is None
    assert log.summary() == "nothing happened"
    assert log.text() == ""


def test_events_come_out_in_order(log):
    assert [event.at for event in log] == [0.0, 12.0, 18.0, 40.0]
    assert log.last().message == "passes K1"


def test_events_can_be_filtered_by_kind(log):
    assert len(log.of(EventKind.TRAIN)) == 2
    assert log.of(EventKind.POINTS) == []


def test_events_can_be_filtered_by_subject(log):
    assert [event.message for event in log.about("K1")] == ["clears to Y"]
    assert log.about("nobody") == []


def test_events_can_be_filtered_by_time(log):
    assert [event.at for event in log.between(10.0, 20.0)] == [12.0, 18.0]
    assert log.between(100.0, 200.0) == []


def test_events_can_be_searched_by_text(log):
    assert len(log.mentioning("K1")) == 1
    assert log.mentioning("derail") == []


def test_events_print_in_columns():
    event = Event(12.0, EventKind.ROUTE, "K1(M)", "requested, accepted")
    assert str(event) == "   12.0s route  K1(M)    requested, accepted"


def test_kinds_print_as_words():
    assert str(EventKind.TRACK) == "track"


def test_the_text_of_a_log_ends_with_a_newline(log):
    assert log.text().endswith("\n")
    assert len(log.text().splitlines()) == 4


def test_the_summary_counts_each_kind(log):
    summary = log.summary()
    assert summary.startswith("4 events over 40s")
    assert "2 train" in summary
    assert "1 route" in summary
