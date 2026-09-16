from cueforge.movement.geometry import Point, distance_units, squared_distance
from cueforge.movement.travel import travel_time_ms


def test_axis_aligned_distance() -> None:
    assert distance_units(Point(0, 5), Point(8, 5)) == 8
    assert squared_distance(Point(0, 0), Point(3, 4)) == 25
    assert distance_units(Point(0, 0), Point(3, 4)) == 5


def test_distance_is_symmetric_and_zero_on_self() -> None:
    a, b = Point(-2, 7), Point(4, 1)
    assert distance_units(a, b) == distance_units(b, a)
    assert distance_units(a, a) == 0


def test_half_up_integer_root_tie() -> None:
    # 2.5^2 = 6.25; nearest ints 2^2=4 and 3^2=9. 6 is closer to 4? 
    # 6-4=2, 9-6=3 so 2 wins. Use an exact midpoint: between n^2 and (n+1)^2
    # midpoint is n^2 + n + 0.5; integer squared values never land exactly
    # halfway except when we define tie as equal distances.
    # For d^2=2: isqrt=1, 1 vs 4, distances 1 and 2 -> 1
    # For a true tie: |s - n^2| == |(n+1)^2 - s|
    # s - n^2 = (n+1)^2 - s => 2s = 2n^2 + 2n + 1 => s not integer.
    # Ties on integers cannot occur; the contract still rounds upward if equal.
    assert distance_units(Point(0, 0), Point(1, 1)) == 1  # sqrt(2)~1.414 -> nearer 1


def test_travel_time_ceil() -> None:
    # distance 8, speed 1.4 u/s = 1400 milli. 8e6/1400 = 5714.285 -> 5715
    assert travel_time_ms(Point(0, 5), Point(8, 5), 1400) == 5715


def test_travel_time_zero_for_same_point() -> None:
    assert travel_time_ms(Point(3, 3), Point(3, 3), 1000) == 0
