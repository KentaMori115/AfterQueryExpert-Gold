"""Small fixtures shared by the tests: a toy network, calendars and a feed."""

from datetime import date

from layover.dates import DateRange
from layover.network import NetworkBuilder
from layover.services import ServiceCalendar, ServiceRegistry

JULY = DateRange(date(2026, 7, 1), date(2026, 7, 31))
MONDAY = date(2026, 7, 6)
SATURDAY = date(2026, 7, 4)


def services():
    """A weekday service and a weekend one, both running through July."""
    return ServiceRegistry(
        [
            ServiceCalendar.weekly("weekday", ["mon", "tue", "wed", "thu", "fri"], JULY),
            ServiceCalendar.weekly("weekend", ["sat", "sun"], JULY),
        ]
    )


def line_network():
    """Two routes crossing at one interchange, four trips each.

    Stops ``a`` to ``d`` run west to east on route ``x``; stops ``m`` to ``p``
    run north to south on route ``y``; both call at ``c``, so a journey from
    ``a`` to ``p`` needs exactly one change.
    """
    builder = NetworkBuilder("toy")
    coordinates = {
        "a": ("52.500", "13.300"),
        "b": ("52.500", "13.320"),
        "c": ("52.500", "13.340"),
        "d": ("52.500", "13.360"),
        "m": ("52.520", "13.340"),
        "n": ("52.510", "13.340"),
        "p": ("52.490", "13.340"),
    }
    for stop_id, (lat, lon) in coordinates.items():
        builder.stop(stop_id, "Stop %s" % stop_id.upper(), lat, lon, zone="A")
    builder.route("x", "X", "West to east", "tram")
    builder.route("y", "Y", "North to south", "bus")
    builder.pattern("x-east", "x", ["a", "b", "c", "d"], "East")
    builder.pattern("x-west", "x", ["d", "c", "b", "a"], "West", direction=1)
    builder.pattern("y-south", "y", ["m", "n", "c", "p"], "South")
    for index in range(4):
        start = 8 * 3600 + index * 600
        builder.trip(
            "x-east-%d" % index,
            "x-east",
            "weekday",
            [start, start + 300, start + 600, start + 900],
        )
        builder.trip(
            "x-west-%d" % index,
            "x-west",
            "weekday",
            [start + 60, start + 360, start + 660, start + 960],
        )
        south = 8 * 3600 + 120 + index * 900
        builder.trip(
            "y-south-%d" % index,
            "y-south",
            "weekday",
            [south, south + 240, south + 480, south + 720],
        )
    builder.trip("x-east-sat", "x-east", "weekend", ["09:00", "09:05", "09:10", "09:15"])
    return builder.build()


def transfer_network():
    """A slow direct route and a quicker one that needs a walk between stops.

    Route ``slow`` runs p to s calling everywhere. Route ``in`` runs p to x and
    route ``out`` runs y to s, with a two minute declared walk from x to y, so
    the quick way there is one change plus that walk.
    """
    builder = NetworkBuilder("transfers")
    for stop_id in ("p", "q", "r", "s", "x", "y"):
        builder.stop(stop_id, "Stop %s" % stop_id.upper(), "52.5", "13.4", zone="A")
    builder.route("slow", "S", "The long way", "bus")
    builder.route("in", "I", "Inbound", "metro")
    builder.route("out", "O", "Outbound", "metro")
    builder.pattern("slow-out", "slow", ["p", "q", "r", "s"], "S")
    builder.pattern("in-out", "in", ["p", "q", "x"], "X")
    builder.pattern("out-out", "out", ["y", "r", "s"], "S")
    builder.transfer("x", "y", 120)
    for index in range(3):
        start = 8 * 3600 + index * 1800
        builder.trip("slow-%d" % index, "slow-out", "weekday", [start, start + 900, start + 1800, start + 2700])
        builder.trip("in-%d" % index, "in-out", "weekday", [start, start + 240, start + 480])
        builder.trip("out-%d" % index, "out-out", "weekday", [start + 720, start + 900, start + 1080])
    return builder.build()


FEED_TEXTS = {
    "stops": (
        "stop_id,name,lat,lon,zone\n"
        "a,Stop A,52.500000,13.300000,A\n"
        "b,Stop B,52.500000,13.320000,A\n"
        "c,Stop C,52.500000,13.340000,B\n"
    ),
    "routes": "route_id,short_name,long_name,mode\nx,X,West to east,tram\n",
    "patterns": "pattern_id,route_id,headsign,direction\nx-east,x,East,0\n",
    "pattern_stops": (
        "pattern_id,sequence,stop_id,pickup,dropoff\n"
        "x-east,1,a,1,0\n"
        "x-east,2,b,1,1\n"
        "x-east,3,c,0,1\n"
    ),
    "trips": "trip_id,pattern_id,service_id,headsign\nt1,x-east,weekday,East\nt2,x-east,weekday,East\n",
    "stop_times": (
        "trip_id,sequence,arrival,departure\n"
        "t1,1,08:00:00,08:00:30\n"
        "t1,2,08:05:00,08:05:30\n"
        "t1,3,08:10:00,08:10:00\n"
        "t2,1,08:20:00,08:20:00\n"
        "t2,2,08:25:00,08:25:00\n"
        "t2,3,08:30:00,08:30:00\n"
    ),
    "calendars": (
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
        "weekday,1,1,1,1,1,0,0,2026-07-01,2026-07-31\n"
    ),
    "calendar_dates": "service_id,date,exception\nweekday,2026-07-14,remove\n",
    "transfers": "from_stop,to_stop,seconds,kind\nb,c,120,walk\n",
    "fare_products": (
        "fare_id,price,currency,transfers,window,name\n"
        "single,2.40,EUR,1,3600,Single\n"
    ),
    "fare_rules": "fare_id,from_zone,to_zone,route_id\nsingle,,,\n",
}


def feed_texts(**changes):
    """The demo feed as text, with any table replaced or dropped."""
    texts = dict(FEED_TEXTS)
    for name, text in changes.items():
        if text is None:
            texts.pop(name, None)
        else:
            texts[name] = text
    return texts


def raw_feed(**changes):
    """The demo feed read into raw tables."""
    from layover.feed import RawFeed

    return RawFeed.of_text(feed_texts(**changes), "inline")


def loaded_feed(**changes):
    """The demo feed loaded into a network, calendars and fares."""
    from layover.feed import load_feed

    return load_feed(raw_feed(**changes), "inline")
