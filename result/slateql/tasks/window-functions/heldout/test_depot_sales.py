"""How windows sit in a query: row order, pruning, grouping and placement."""

from __future__ import annotations

import pytest

from slateql import Session
from slateql.config import SessionConfig
from slateql.errors import SlateQLError
from slateql.types.datatypes import INTEGER, STRING
from slateql.types.schema import Schema

SALES_SCHEMA = Schema.of(
    ("ticket", INTEGER),
    ("depot", STRING),
    ("crates", INTEGER),
)

# Arrival order is neither depot order nor crate order, so any query that comes
# back sorted has reordered rows it was not asked to reorder.  Every crate count
# differs, so nothing below depends on how ties are broken.
SALES_ROWS = [
    [101, "kiel", 5],
    [102, "arles", 9],
    [103, "kiel", 2],
    [104, "bruges", 7],
    [105, "arles", 6],
    [106, "kiel", 4],
]

ARRIVAL = [101, 102, 103, 104, 105, 106]


def sales(**options) -> Session:
    """A session holding the sales table, optionally reconfigured."""

    session = Session(config=SessionConfig(**options)) if options else Session()
    session.register_rows("sales", SALES_SCHEMA, SALES_ROWS)
    return session


def first_column(session: Session, sql: str) -> list:
    """Run ``sql`` and return its first column, in the order rows came back."""

    return [row[0] for row in session.sql(sql).rows]


def test_tickets_come_back_as_they_went_in():
    """A window sorts internally; the statement did not ask for a sort."""

    order = first_column(
        sales(),
        "SELECT ticket, ROW_NUMBER() OVER (ORDER BY crates) AS n FROM sales",
    )
    assert order == ARRIVAL


def test_depot_totals_do_not_regroup_the_output():
    """Grouping rows into partitions must not group them in the output."""

    order = first_column(
        sales(),
        "SELECT ticket, SUM(crates) OVER (PARTITION BY depot) AS total FROM sales",
    )
    assert order == ARRIVAL


def test_ranked_and_split_and_still_unsorted():
    """Both halves of the window at once, and the rows still arrive as they were."""

    order = first_column(
        sales(),
        "SELECT ticket, RANK() OVER (PARTITION BY depot ORDER BY crates DESC) AS r "
        "FROM sales",
    )
    assert order == ARRIVAL


def test_an_explicit_sort_is_obeyed():
    """An explicit ORDER BY is the one thing that may change the row order."""

    order = first_column(
        sales(),
        "SELECT ticket, COUNT(*) OVER () AS seen FROM sales ORDER BY crates, ticket",
    )
    assert order == [103, 106, 101, 105, 104, 102]


def test_crates_drive_the_numbering_unseen():
    """crates never reaches the output and still drives the ranking."""

    result = sales().sql(
        "SELECT ROW_NUMBER() OVER (ORDER BY crates) AS n FROM sales"
    )
    assert result.columns == ["n"]
    assert [row[0] for row in result.rows] == [3, 6, 1, 5, 4, 2]


def test_depot_groups_the_totals_unseen():
    """Same for the partition key: depot is read, never returned."""

    result = sales().sql(
        "SELECT SUM(crates) OVER (PARTITION BY depot) AS total FROM sales"
    )
    assert result.columns == ["total"]
    assert [row[0] for row in result.rows] == [11, 15, 11, 7, 15, 11]


def test_same_answer_with_the_optimizer_off():
    """The answer is the same whether or not the optimizer touched the plan."""

    query = (
        "SELECT DENSE_RANK() OVER (PARTITION BY depot ORDER BY crates) AS r "
        "FROM sales"
    )
    optimized = [row[0] for row in sales().sql(query).rows]
    plain = [row[0] for row in sales(optimize=False).sql(query).rows]
    assert optimized == plain
    assert optimized == [3, 2, 1, 1, 1, 2]


def test_depots_ranked_by_the_total_they_made():
    """RANK over SUM: one row per depot, ranked by the total it just computed."""

    result = sales().sql(
        "SELECT depot, SUM(crates) AS total, "
        "RANK() OVER (ORDER BY SUM(crates) DESC) AS place "
        "FROM sales GROUP BY depot"
    )
    assert result.rows == [["kiel", 11, 2], ["arles", 15, 1], ["bruges", 7, 3]]


def test_counting_depots_rather_than_tickets():
    """The window sits above the grouping, so it sees three rows, not six."""

    result = sales().sql(
        "SELECT depot, COUNT(*) OVER () AS depots FROM sales GROUP BY depot"
    )
    assert result.rows == [["kiel", 3], ["arles", 3], ["bruges", 3]]


def test_the_tickets_across_every_depot():
    """SUM over COUNT: the window folds the counts the grouping just made."""

    result = sales().sql(
        "SELECT depot, COUNT(*) AS tickets, SUM(COUNT(*)) OVER () AS all_tickets "
        "FROM sales GROUP BY depot"
    )
    assert result.rows == [["kiel", 3, 6], ["arles", 2, 6], ["bruges", 1, 6]]


def test_how_far_each_depot_trails_the_best():
    """A group total next to the largest group total, on the same row."""

    result = sales().sql(
        "SELECT depot, SUM(crates) AS total, "
        "SUM(crates) - MAX(SUM(crates)) OVER () AS behind "
        "FROM sales GROUP BY depot"
    )
    assert result.rows == [["kiel", 11, -4], ["arles", 15, 0], ["bruges", 7, -8]]


def test_having_thins_the_groups_before_the_fold():
    """A group HAVING drops is gone before the window counts anything."""

    result = sales().sql(
        "SELECT depot, COUNT(*) AS tickets, SUM(COUNT(*)) OVER () AS all_tickets "
        "FROM sales GROUP BY depot HAVING COUNT(*) > 1"
    )
    assert result.rows == [["kiel", 3, 5], ["arles", 2, 5]]


def test_groups_partitioned_by_their_own_size():
    """The partition key may be an aggregate too: busy depots against quiet ones."""

    result = sales().sql(
        "SELECT depot, SUM(crates) AS total, "
        "SUM(SUM(crates)) OVER (PARTITION BY COUNT(*) > 1) AS alike "
        "FROM sales GROUP BY depot"
    )
    assert result.rows == [["kiel", 11, 26], ["arles", 15, 26], ["bruges", 7, 7]]


def test_a_running_total_over_the_depot_totals():
    """Ordered by a group total, the fold runs across the groups in that order."""

    result = sales().sql(
        "SELECT depot, SUM(crates) AS total, "
        "SUM(SUM(crates)) OVER (ORDER BY SUM(crates)) AS so_far "
        "FROM sales GROUP BY depot"
    )
    assert result.rows == [["kiel", 11, 18], ["arles", 15, 33], ["bruges", 7, 7]]


def test_sorting_by_the_number_just_computed():
    """A window column is an output column and sorting may name it."""

    result = sales().sql(
        "SELECT ticket, ROW_NUMBER() OVER (ORDER BY crates) AS n "
        "FROM sales ORDER BY n DESC"
    )
    assert [row[1] for row in result.rows] == [6, 5, 4, 3, 2, 1]
    assert [row[0] for row in result.rows] == [102, 104, 105, 101, 106, 103]


def test_sorting_by_a_number_never_shown():
    """Sorting by a window nobody selected still sorts, and returns two columns."""

    result = sales().sql(
        "SELECT ticket, depot FROM sales "
        "ORDER BY RANK() OVER (PARTITION BY depot ORDER BY crates), ticket"
    )
    assert result.columns == ["ticket", "depot"]
    assert [row[0] for row in result.rows] == [103, 104, 105, 102, 106, 101]


def test_two_tickets_still_read_the_whole_total():
    """Two rows come back, and both read the six-row total."""

    result = sales().sql(
        "SELECT ticket, SUM(crates) OVER () AS total FROM sales LIMIT 2"
    )
    assert result.rows == [[101, 33], [102, 33]]


def test_skipping_rows_leaves_numbering_alone():
    """Skipping rows happens after the window, so the numbering is unchanged."""

    result = sales().sql(
        "SELECT ticket, ROW_NUMBER() OVER (ORDER BY crates) AS n "
        "FROM sales LIMIT 2 OFFSET 3"
    )
    assert result.rows == [[104, 5], [105, 4]]


def test_filtered_tickets_never_reach_the_total():
    """Filtered rows are gone by the time the window folds anything."""

    result = sales().sql(
        "SELECT ticket, SUM(crates) OVER () AS total FROM sales WHERE crates > 4"
    )
    assert result.rows == [[101, 27], [102, 27], [104, 27], [105, 27]]


def test_one_kiel_ticket_left_is_a_partition_of_one():
    """One kiel row survives the filter, so its partition holds one row."""

    result = sales().sql(
        "SELECT ticket, COUNT(*) OVER (PARTITION BY depot) AS nearby "
        "FROM sales WHERE crates > 4"
    )
    assert result.rows == [[101, 1], [102, 2], [104, 1], [105, 2]]


def test_numbering_in_a_filter_is_refused():
    """WHERE picks rows before any window exists, so this cannot be answered."""

    session = sales()
    assert len(session.sql(
        "SELECT ticket, ROW_NUMBER() OVER () AS n FROM sales"
    ).rows) == 6
    with pytest.raises(SlateQLError):
        session.sql("SELECT ticket FROM sales WHERE ROW_NUMBER() OVER () = 1")


def test_ranking_as_a_group_key_is_refused():
    """Grouping happens below the window and cannot key on one."""

    session = sales()
    assert len(session.sql(
        "SELECT depot, RANK() OVER (ORDER BY depot) AS r FROM sales GROUP BY depot"
    ).rows) == 3
    with pytest.raises(SlateQLError):
        session.sql(
            "SELECT depot FROM sales GROUP BY depot, RANK() OVER (ORDER BY depot)"
        )


def test_counting_in_having_is_refused():
    """HAVING filters groups, which is still below the window."""

    session = sales()
    assert len(session.sql(
        "SELECT depot, COUNT(*) OVER () AS d FROM sales GROUP BY depot"
    ).rows) == 3
    with pytest.raises(SlateQLError):
        session.sql(
            "SELECT depot FROM sales GROUP BY depot "
            "HAVING COUNT(*) OVER () > 1"
        )


def test_distinct_and_over_together_are_refused():
    """The plain form totals 33; asking for it de-duplicated is refused."""

    session = sales()
    assert session.sql(
        "SELECT SUM(crates) OVER () AS total FROM sales"
    ).rows[0] == [33]
    with pytest.raises(SlateQLError):
        session.sql("SELECT SUM(DISTINCT crates) OVER () AS total FROM sales")


def test_upper_with_over_is_refused():
    """A scalar function reads one row and has no window to read."""

    session = sales()
    assert session.sql(
        "SELECT COUNT(*) OVER () AS seen FROM sales"
    ).rows[0] == [6]
    with pytest.raises(SlateQLError):
        session.sql("SELECT UPPER(depot) OVER () AS shouted FROM sales")



def test_a_window_orders_by_the_count_it_also_selects():
    """The same COUNT(*) is a selected value and the window's ordering key."""

    result = sales().sql(
        "SELECT depot, COUNT(*) AS tickets, "
        "COUNT(*) OVER (ORDER BY COUNT(*)) AS ranked "
        "FROM sales GROUP BY depot"
    )
    # Ordered by group size the depots run bruges, arles, kiel, and the window
    # counts groups through the current run.
    assert result.rows == [["kiel", 3, 3], ["arles", 2, 2], ["bruges", 1, 1]]


def test_the_count_a_group_shows_can_carry_a_frame():
    """A frame and an exclusion apply to a fold over the groups just made."""

    result = sales().sql(
        "SELECT depot, COUNT(*) AS tickets, "
        "COUNT(*) OVER (ORDER BY COUNT(*) ROWS 1 PRECEDING EXCLUDE CURRENT ROW) "
        "AS others FROM sales GROUP BY depot"
    )
    # Each group reads itself and the one before it, then drops itself, so
    # bruges opens the ordering with nothing behind it.
    assert result.rows == [["kiel", 3, 1], ["arles", 2, 1], ["bruges", 1, 0]]


def test_the_tickets_run_down_from_the_busiest_depot():
    """Ordering the fold DESC accumulates from the largest group down."""

    result = sales().sql(
        "SELECT depot, COUNT(*) AS tickets, "
        "SUM(COUNT(*)) OVER (ORDER BY COUNT(*) DESC) AS running "
        "FROM sales GROUP BY depot"
    )
    assert result.rows == [["kiel", 3, 3], ["arles", 2, 5], ["bruges", 1, 6]]


def test_up_and_down_numbering_at_once():
    """One select list, two orderings, and neither disturbs the other."""

    result = sales().sql(
        "SELECT ticket, "
        "ROW_NUMBER() OVER (ORDER BY crates) AS up, "
        "ROW_NUMBER() OVER (ORDER BY crates DESC) AS down "
        "FROM sales"
    )
    assert result.rows == [
        [101, 3, 4],
        [102, 6, 1],
        [103, 1, 6],
        [104, 5, 2],
        [105, 4, 3],
        [106, 2, 5],
    ]


def test_filter_then_count_then_take_two():
    """Four rows survive WHERE, the window counts them, LIMIT keeps two."""

    result = sales().sql(
        "SELECT ticket, COUNT(*) OVER () AS seen FROM sales "
        "WHERE crates > 4 LIMIT 2"
    )
    assert result.rows == [[101, 4], [102, 4]]


def test_three_windows_read_the_table_once():
    """Three windows, one pass: the scan counts six rows, not eighteen."""

    result = sales().sql(
        "SELECT ticket, "
        "COUNT(*) OVER () AS seen, "
        "SUM(crates) OVER (PARTITION BY depot) AS total, "
        "ROW_NUMBER() OVER (ORDER BY crates) AS n "
        "FROM sales"
    )
    assert len(result.rows) == 6
    assert result.metrics["rows_scanned"] == 6
