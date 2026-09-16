from cueforge.codes import CF4001_RESERVATION_CONFLICT, CF4002_CAPACITY_EXCEEDED
from cueforge.resources.capacity import detect_capacity_conflicts
from cueforge.resources.reservations import Interval, Reservation


def test_boundary_touch_does_not_overlap() -> None:
    left = Interval(0, 1000)
    right = Interval(1000, 2000)
    assert not left.overlaps(right)
    assert left.intersection(right) is None


def test_overlap_is_detected() -> None:
    assert Interval(0, 5000).overlaps(Interval(2000, 7000))


def test_exclusive_conflict_finding() -> None:
    reservations = [
        Reservation("proj", "a", Interval(0, 5000)),
        Reservation("proj", "b", Interval(2000, 7000)),
    ]
    findings = detect_capacity_conflicts(reservations, {"proj": 1})
    assert any(item.code == CF4001_RESERVATION_CONFLICT for item in findings)
    witness = next(item.witness for item in findings if item.code == CF4001_RESERVATION_CONFLICT)
    assert witness["cues"] == "a,b"


def test_capacity_two_allows_two_claimants() -> None:
    reservations = [
        Reservation("radio", "a", Interval(0, 5000)),
        Reservation("radio", "b", Interval(2000, 7000)),
    ]
    findings = detect_capacity_conflicts(reservations, {"radio": 2})
    assert findings == []


def test_capacity_two_rejects_three_claimants() -> None:
    reservations = [
        Reservation("radio", "a", Interval(0, 5000)),
        Reservation("radio", "b", Interval(1000, 4000)),
        Reservation("radio", "c", Interval(2000, 3000)),
    ]
    findings = detect_capacity_conflicts(reservations, {"radio": 2})
    assert any(item.code == CF4002_CAPACITY_EXCEEDED for item in findings)


def test_reservation_sort_key_is_stable() -> None:
    a = Reservation("r", "b", Interval(0, 10))
    b = Reservation("r", "a", Interval(0, 10))
    ordered = sorted([a, b], key=lambda item: item.sort_key())
    assert [item.cue_id for item in ordered] == ["a", "b"]
