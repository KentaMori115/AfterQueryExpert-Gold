import pytest

from signalbox.errors import InterlockingError, LayoutError
from signalbox.layout.loader import load_directory, load_path
from signalbox.signalling.signal import SignalType
from signalbox.topology.graph import Sense
from signalbox.topology.scheme import scheme_from_text


def test_the_fixture_loads_and_describes_itself(kingsmoor):
    assert kingsmoor.area == "Kingsmoor Junction"
    assert kingsmoor.prefix == "K"
    assert kingsmoor.describe() == (
        "Kingsmoor Junction: 21 nodes, 20 edges, 20 sections, 10 signals"
    )


def test_every_edge_belongs_to_a_section(kingsmoor):
    assert kingsmoor.sections.unassigned(kingsmoor.graph) == []


def test_signals_face_the_way_the_plan_says(kingsmoor):
    assert kingsmoor.signal("K1").position.sense is Sense.NOMINAL
    assert kingsmoor.signal("K2").position.sense is Sense.REVERSE


def test_shunt_signals_are_separated_from_running_ones(kingsmoor):
    assert [s.name for s in kingsmoor.shunt_signals()] == ["K20", "K22"]
    assert "K20" not in [s.name for s in kingsmoor.running_signals()]
    assert kingsmoor.signal("K20").type is SignalType.SHUNT


def test_signals_on_an_edge_come_out_in_order(kingsmoor):
    assert [s.name for s in kingsmoor.signals_on("D1")] == ["K1"]
    assert kingsmoor.signals_on("CX") == []


def test_traffic_direction_is_available(kingsmoor):
    assert kingsmoor.direction_of("K1") == "down"
    assert kingsmoor.direction_of("K2") == "up"
    assert kingsmoor.direction_of("K20") is None


def test_unknown_signal_is_reported(kingsmoor):
    with pytest.raises(InterlockingError, match="no signal called K99"):
        kingsmoor.signal("K99")


def test_unknown_signal_type_is_refused():
    with pytest.raises(InterlockingError, match="unknown type 'semaphore'"):
        scheme_from_text(
            "node A boundary\nnode B boundary\n"
            "edge E1 from A to B length 100\n"
            "signal S1 on E1 at 10 facing forward type semaphore\n"
        )


def test_subsidiary_and_automatic_flags_are_read():
    scheme = scheme_from_text(
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 100\n"
        "signal S1 on E1 at 10 facing forward subsidiary yes automatic yes\n"
    )
    assert scheme.signal("S1").subsidiary
    assert scheme.signal("S1").automatic


def test_loading_a_missing_file_says_so(tmp_path):
    with pytest.raises(LayoutError, match="cannot read"):
        load_path(tmp_path / "nothing.sbx")


def test_loading_a_directory_of_plans(tmp_path):
    (tmp_path / "one.sbx").write_text(
        "node A boundary\nnode B boundary\nedge E1 from A to B length 5\n"
    )
    (tmp_path / "two.sbx").write_text(
        "node C boundary\nnode D boundary\nedge E2 from C to D length 5\n"
    )
    (tmp_path / "notes.txt").write_text("ignore me")
    plans = load_directory(tmp_path)
    assert [p.edges[0].name for p in plans] == ["E1", "E2"]


def test_loading_a_directory_that_is_not_one(tmp_path):
    with pytest.raises(LayoutError, match="is not a directory"):
        load_directory(tmp_path / "nope")
