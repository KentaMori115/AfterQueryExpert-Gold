"""The rungs a working order concedes through before it pays the market."""

from django.test import SimpleTestCase

from Engine.ladder import ladder_prices


# Tick grids the engines already trade: pennies on XSP, nickels on SPX.
PENNY = 0.01
NICKEL = 0.05


class LadderSpanTests(SimpleTestCase):
    """Rungs divide the span from the midpoint to the far touch evenly."""

    def test_debit_ladder_walks_up_to_the_far_touch(self):
        self.assertEqual(
            ladder_prices(3.11, 3.27, 4, PENNY, False),
            [3.11, 3.16, 3.21, 3.27],
        )

    def test_credit_ladder_walks_down_to_the_far_touch(self):
        self.assertEqual(
            ladder_prices(5.43, 5.25, 4, PENNY, True),
            [5.43, 5.37, 5.31, 5.25],
        )

    def test_first_rung_is_the_midpoint(self):
        rungs = ladder_prices(3.11, 3.27, 4, PENNY, False)
        self.assertEqual(rungs[0], 3.11)

    def test_last_rung_reaches_the_far_touch(self):
        rungs = ladder_prices(3.11, 3.27, 4, PENNY, False)
        self.assertEqual(rungs[-1], 3.27)

    def test_two_rungs_are_just_the_two_ends(self):
        self.assertEqual(ladder_prices(3.11, 3.27, 2, PENNY, False), [3.11, 3.27])

    def test_six_rungs_split_the_span_five_ways(self):
        self.assertEqual(
            ladder_prices(1.00, 1.50, 6, PENNY, False),
            [1.00, 1.10, 1.20, 1.30, 1.40, 1.50],
        )

    def test_one_rung_is_the_midpoint_alone(self):
        self.assertEqual(ladder_prices(1.234, 2.00, 1, PENNY, False), [1.23])

    def test_debit_rungs_increase(self):
        rungs = ladder_prices(3.11, 3.27, 4, PENNY, False)
        self.assertEqual(rungs, sorted(rungs))

    def test_credit_rungs_decrease(self):
        rungs = ladder_prices(5.43, 5.25, 4, PENNY, True)
        self.assertEqual(rungs, sorted(rungs, reverse=True))

    def test_mid_equal_to_far_gives_one_rung(self):
        self.assertEqual(ladder_prices(2.50, 2.50, 4, PENNY, False), [2.50])


class LadderGridTests(SimpleTestCase):
    """Every rung sits on the grid, snapped the way the account prefers."""

    def test_debit_rungs_round_down(self):
        self.assertEqual(
            ladder_prices(3.11, 3.27, 4, NICKEL, False),
            [3.10, 3.15, 3.20, 3.25],
        )

    def test_credit_rungs_round_up(self):
        self.assertEqual(
            ladder_prices(5.43, 5.25, 4, NICKEL, True),
            [5.45, 5.40, 5.35, 5.25],
        )

    def test_a_penny_price_already_on_the_grid_does_not_move(self):
        # 0.29 / 0.01 is 28.999999999999996 in binary floating point, so a
        # build that floors the raw quotient quotes this at 0.28
        self.assertEqual(ladder_prices(0.29, 0.29, 1, PENNY, False), [0.29])

    def test_a_nickel_price_already_on_the_grid_does_not_move(self):
        # 1.15 / 0.05 is 22.999999999999996 the same way
        self.assertEqual(ladder_prices(1.15, 1.15, 1, NICKEL, False), [1.15])

    def test_another_nickel_price_already_on_the_grid_does_not_move(self):
        self.assertEqual(ladder_prices(2.90, 2.90, 1, NICKEL, False), [2.90])

    def test_grid_exact_credit_price_does_not_move(self):
        self.assertEqual(ladder_prices(0.29, 0.29, 1, PENNY, True), [0.29])

    def test_debit_last_rung_stays_short_of_an_off_grid_far_touch(self):
        rungs = ladder_prices(1.00, 1.234, 2, PENNY, False)
        self.assertEqual(rungs, [1.00, 1.23])
        self.assertLess(rungs[-1], 1.234)

    def test_credit_last_rung_stays_above_an_off_grid_far_touch(self):
        rungs = ladder_prices(2.00, 1.234, 2, PENNY, True)
        self.assertEqual(rungs, [2.00, 1.24])
        self.assertGreater(rungs[-1], 1.234)

    def test_nickel_grid_off_grid_span(self):
        self.assertEqual(
            ladder_prices(5.425, 5.60, 4, NICKEL, False),
            [5.40, 5.45, 5.50, 5.60],
        )

    def test_midpoint_snaps_before_it_is_quoted(self):
        self.assertEqual(ladder_prices(4.324999, 4.05, 4, PENNY, True)[0], 4.33)


class LadderShorteningTests(SimpleTestCase):
    """A rung that repeats the one before it is not a replacement."""

    def test_repeated_rungs_are_dropped(self):
        self.assertEqual(
            ladder_prices(1.00, 1.02, 5, PENNY, False),
            [1.00, 1.01, 1.02],
        )

    def test_a_span_under_one_tick_collapses_to_one_rung(self):
        self.assertEqual(ladder_prices(1.00, 1.001, 4, PENNY, False), [1.00])

    def test_credit_span_under_one_tick_collapses_to_one_rung(self):
        self.assertEqual(ladder_prices(1.00, 0.999, 4, PENNY, True), [1.00])

    def test_shortened_ladder_has_no_repeats(self):
        rungs = ladder_prices(2.00, 2.03, 8, PENNY, False)
        self.assertEqual(len(rungs), len(set(rungs)))

    def test_shortened_ladder_still_ends_at_the_far_touch(self):
        rungs = ladder_prices(2.00, 2.03, 8, PENNY, False)
        self.assertEqual(rungs[-1], 2.03)

    def test_nickel_grid_shortens_a_penny_wide_span(self):
        self.assertEqual(ladder_prices(2.00, 2.04, 5, NICKEL, False), [2.00])

    def test_more_steps_never_yields_more_rungs_than_the_grid_allows(self):
        rungs = ladder_prices(1.00, 1.03, 8, PENNY, False)
        self.assertEqual(rungs, [1.00, 1.01, 1.02, 1.03])


class LadderDropTests(SimpleTestCase):
    """Rungs that are not worth quoting never make the list."""

    def test_non_positive_rungs_are_dropped(self):
        self.assertEqual(ladder_prices(0.03, -0.05, 4, PENNY, True), [0.03, 0.01])

    def test_a_span_entirely_below_zero_gives_nothing(self):
        self.assertEqual(ladder_prices(-0.10, -0.30, 4, PENNY, True), [])

    def test_a_zero_midpoint_is_not_quoted(self):
        self.assertEqual(ladder_prices(0.00, 0.00, 3, PENNY, False), [])

    def test_no_rung_is_zero_or_less(self):
        for rung in ladder_prices(0.03, -0.05, 6, PENNY, True):
            self.assertGreater(rung, 0)


class LadderGuardTests(SimpleTestCase):
    """Arguments that cannot describe a ladder produce none."""

    def test_zero_steps_gives_nothing(self):
        self.assertEqual(ladder_prices(3.11, 3.27, 0, PENNY, False), [])

    def test_negative_steps_gives_nothing(self):
        self.assertEqual(ladder_prices(3.11, 3.27, -2, PENNY, False), [])

    def test_zero_tick_gives_nothing(self):
        self.assertEqual(ladder_prices(3.11, 3.27, 4, 0.0, False), [])

    def test_negative_tick_gives_nothing(self):
        self.assertEqual(ladder_prices(3.11, 3.27, 4, -0.01, False), [])

    def test_missing_midpoint_gives_nothing(self):
        self.assertEqual(ladder_prices(None, 3.27, 4, PENNY, False), [])

    def test_missing_far_touch_gives_nothing(self):
        self.assertEqual(ladder_prices(3.11, None, 4, PENNY, False), [])

    def test_missing_tick_gives_nothing(self):
        self.assertEqual(ladder_prices(3.11, 3.27, 4, None, False), [])


class LadderStepCountTests(SimpleTestCase):
    """Every requested step count that the grid can actually carry."""

    def test_three_rungs_split_the_span_in_half(self):
        self.assertEqual(ladder_prices(2.00, 2.40, 3, PENNY, False), [2.00, 2.20, 2.40])

    def test_five_rungs_split_the_span_in_quarters(self):
        self.assertEqual(
            ladder_prices(2.00, 2.40, 5, PENNY, False),
            [2.00, 2.10, 2.20, 2.30, 2.40],
        )

    def test_eight_rungs_split_the_span_in_sevenths(self):
        self.assertEqual(
            ladder_prices(1.00, 1.70, 8, PENNY, False),
            [1.00, 1.10, 1.20, 1.30, 1.40, 1.50, 1.60, 1.70],
        )

    def test_a_credit_span_in_thirds(self):
        self.assertEqual(ladder_prices(2.40, 2.00, 3, PENNY, True), [2.40, 2.20, 2.00])

    def test_uneven_thirds_round_toward_the_account(self):
        # the raw middle rung is 1.3333, which a debit keeps at 1.33
        self.assertEqual(ladder_prices(1.00, 2.00, 4, PENNY, False)[1], 1.33)

    def test_uneven_thirds_round_the_other_way_for_a_credit(self):
        # the same raw 1.6667 rung becomes 1.67 when it is money coming in
        self.assertEqual(ladder_prices(2.00, 1.00, 4, PENNY, True)[1], 1.67)

    def test_the_two_sides_do_not_agree_on_an_uneven_rung(self):
        debit = ladder_prices(1.00, 2.00, 4, PENNY, False)
        credit = ladder_prices(2.00, 1.00, 4, PENNY, True)
        self.assertNotEqual(debit[1], credit[2])


class LadderMonotonicTests(SimpleTestCase):
    """The list is strictly ordered, whatever the grid does to it."""

    def test_debit_rungs_are_strictly_increasing(self):
        rungs = ladder_prices(1.00, 1.09, 6, PENNY, False)
        for earlier, later in zip(rungs, rungs[1:]):
            self.assertLess(earlier, later)

    def test_credit_rungs_are_strictly_decreasing(self):
        rungs = ladder_prices(1.09, 1.00, 6, PENNY, True)
        for earlier, later in zip(rungs, rungs[1:]):
            self.assertGreater(earlier, later)

    def test_a_coarse_grid_still_produces_a_strict_order(self):
        rungs = ladder_prices(1.00, 1.30, 9, NICKEL, False)
        self.assertEqual(len(rungs), len(set(rungs)))
        self.assertEqual(rungs, sorted(rungs))

    def test_no_rung_passes_the_far_touch_on_a_debit(self):
        for rung in ladder_prices(1.00, 1.234, 7, PENNY, False):
            self.assertLessEqual(rung, 1.234)

    def test_no_rung_passes_the_far_touch_on_a_credit(self):
        for rung in ladder_prices(2.00, 1.234, 7, PENNY, True):
            self.assertGreaterEqual(rung, 1.234)

    def test_no_rung_starts_before_the_midpoint_on_a_debit(self):
        for rung in ladder_prices(1.004, 1.30, 7, PENNY, False):
            self.assertLessEqual(1.00, rung)

    def test_the_ladder_is_a_list(self):
        self.assertIsInstance(ladder_prices(1.00, 1.30, 4, PENNY, False), list)


