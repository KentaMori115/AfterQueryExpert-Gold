import csv
import io

import pytest

from signalbox.interchange.csv_io import (
    FILES,
    aspects_csv,
    control_csv,
    locking_csv,
    points_csv,
    write_all,
)
from signalbox.interchange.json_io import InterchangeError
from signalbox.signalling.interlocking import build_interlocking


@pytest.fixture
def lock(kingsmoor):
    return build_interlocking(kingsmoor)


def rows(text):
    return list(csv.reader(io.StringIO(text)))


def test_the_control_table_comes_out_with_a_heading(kingsmoor, lock):
    table = rows(control_csv(kingsmoor, lock))
    assert table[0][0] == "route"
    assert table[1][0] == "K1(M)"
    assert len(table) == len(lock) + 1


def test_the_points_table_comes_out(kingsmoor, lock):
    table = rows(points_csv(kingsmoor, lock))
    assert table[0][0] == "points"
    assert "P101" in [row[0] for row in table]


def test_the_aspect_table_comes_out(kingsmoor, lock):
    table = rows(aspects_csv(kingsmoor, lock))
    assert table[0][0] == "signal"
    assert any(row[0] == "K1" for row in table[1:])


def test_the_locking_table_comes_out(kingsmoor, lock):
    table = rows(locking_csv(kingsmoor, lock))
    assert table[0][0] == "route"
    assert any("TB-AB" in cell for row in table for cell in row)


def test_writing_everything_makes_four_files(tmp_path, kingsmoor, lock):
    written = write_all(tmp_path / "out", kingsmoor, lock)
    assert [path.name for path in written] == list(FILES)
    assert all(path.exists() for path in written)


def test_the_directory_is_made_if_it_is_not_there(tmp_path, kingsmoor, lock):
    target = tmp_path / "deep" / "down"
    write_all(target, kingsmoor, lock)
    assert (target / "control.csv").exists()


def test_writing_the_same_scheme_twice_gives_the_same_bytes(tmp_path, kingsmoor, lock):
    first = write_all(tmp_path / "a", kingsmoor, lock)
    second = write_all(tmp_path / "b", kingsmoor, lock)
    for one, two in zip(first, second, strict=True):
        assert one.read_text() == two.read_text()


def test_somewhere_impossible_is_reported(tmp_path, kingsmoor, lock):
    blocker = tmp_path / "blocker"
    blocker.write_text("not a directory")
    with pytest.raises(InterchangeError):
        write_all(blocker / "out", kingsmoor, lock)


def test_every_row_has_as_many_cells_as_the_heading(kingsmoor, lock):
    for text in (
        control_csv(kingsmoor, lock),
        points_csv(kingsmoor, lock),
        aspects_csv(kingsmoor, lock),
        locking_csv(kingsmoor, lock),
    ):
        table = rows(text)
        assert all(len(row) == len(table[0]) for row in table)
