"""The ``bench`` subcommand: time a statement over several runs."""

from __future__ import annotations

import argparse

from ...session import Session
from ...util.timing import Stopwatch, format_duration

__all__ = ["configure", "run"]


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("sql", help="the statement to benchmark")
    parser.add_argument(
        "-n",
        "--runs",
        type=int,
        default=5,
        help="number of timed runs (default: 5)",
    )
    parser.add_argument(
        "--warmup",
        type=int,
        default=1,
        help="untimed runs before measuring (default: 1)",
    )
    parser.add_argument(
        "--no-optimize",
        action="store_true",
        help="disable the optimizer for comparison",
    )


def run(session: Session, args: argparse.Namespace) -> int:
    if args.runs < 1:
        print("error: --runs must be at least 1")
        return 2
    if args.no_optimize:
        session.configure(optimize=False)

    for _ in range(max(args.warmup, 0)):
        session.sql(args.sql)

    timings: list[float] = []
    rows = 0
    for _ in range(args.runs):
        watch = Stopwatch(start=True)
        result = session.sql(args.sql)
        watch.stop()
        timings.append(watch.elapsed)
        rows = len(result)

    timings.sort()
    total = sum(timings)
    print(f"rows:   {rows}")
    print(f"runs:   {args.runs}")
    print(f"min:    {format_duration(timings[0])}")
    print(f"median: {format_duration(timings[len(timings) // 2])}")
    print(f"max:    {format_duration(timings[-1])}")
    print(f"mean:   {format_duration(total / len(timings))}")
    return 0
