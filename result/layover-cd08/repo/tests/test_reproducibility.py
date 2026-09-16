"""The same question answers the same way, in this interpreter and the next.

The digests below are pinned on purpose. If one of them moves, something about
what the engine writes has changed: the rendering, the ordering, the demo
network or the document format. That is allowed, but it has to be deliberate,
and the number here is edited in the same commit as the change that moved it.

The last test runs the same work in a fresh interpreter under two different hash
seeds, which is what catches an answer that quietly depends on the iteration
order of a set.
"""

import hashlib
import os
import subprocess
import sys
import unittest

from layover.demo import DEMO_DATE, demo_contents, demo_feed_text
from layover.document import document_digest
from layover.session import Session
from layover.times import parse_clock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PINNED = {
    "document": "6e498b35ccad5881",
    "feed": "b44723c5bd2923e0",
    "board": "3200b1a350435de2",
    "journeys": "827b3ba169ef3ad6",
    "itinerary": "61f6564b94f4e154",
    "timetable": "2910e338f8959d1b",
    "stops": "d27a6ea6d94c0f85",
}

PROGRAM = """
import hashlib, json, sys
sys.path.insert(0, %r)
from layover.demo import DEMO_DATE, demo_contents, demo_feed_text
from layover.document import document_digest
from layover.session import Session
from layover.times import parse_clock

def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]

session = Session.demo()
journeys = session.plan("westtor", "strandbad", DEMO_DATE, parse_clock("08:00"))
print(json.dumps({
    "document": document_digest(demo_contents())[:16],
    "feed": sha("".join(text for _, text in sorted(demo_feed_text().items()))),
    "board": sha(session.board("hbf-u1", DEMO_DATE, parse_clock("08:00"), 8).as_text()),
    "journeys": sha(session.journeys_report(journeys).as_text()),
    "itinerary": sha(session.itinerary(journeys[0], priced=True).as_text()),
    "timetable": sha(session.pattern_timetable("u1-east", DEMO_DATE).as_text()),
    "stops": sha(session.stops(DEMO_DATE).as_csv()),
}, sort_keys=True))
""" % ROOT


def sha(text):
    """The first half of the sha256 of some text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def digests():
    """Every pinned digest, worked out here and now."""
    session = Session.demo()
    journeys = session.plan("westtor", "strandbad", DEMO_DATE, parse_clock("08:00"))
    return {
        "document": document_digest(demo_contents())[:16],
        "feed": sha("".join(text for _, text in sorted(demo_feed_text().items()))),
        "board": sha(session.board("hbf-u1", DEMO_DATE, parse_clock("08:00"), 8).as_text()),
        "journeys": sha(session.journeys_report(journeys).as_text()),
        "itinerary": sha(session.itinerary(journeys[0], priced=True).as_text()),
        "timetable": sha(session.pattern_timetable("u1-east", DEMO_DATE).as_text()),
        "stops": sha(session.stops(DEMO_DATE).as_csv()),
    }


class PinnedTest(unittest.TestCase):
    def setUp(self):
        self.digests = digests()

    def test_every_pin_is_checked(self):
        self.assertEqual(set(self.digests), set(PINNED))

    def test_the_document_digest(self):
        self.assertEqual(self.digests["document"], PINNED["document"])

    def test_the_feed_digest(self):
        self.assertEqual(self.digests["feed"], PINNED["feed"])

    def test_the_board_digest(self):
        self.assertEqual(self.digests["board"], PINNED["board"])

    def test_the_journeys_digest(self):
        self.assertEqual(self.digests["journeys"], PINNED["journeys"])

    def test_the_itinerary_digest(self):
        self.assertEqual(self.digests["itinerary"], PINNED["itinerary"])

    def test_the_timetable_digest(self):
        self.assertEqual(self.digests["timetable"], PINNED["timetable"])

    def test_the_stops_digest(self):
        self.assertEqual(self.digests["stops"], PINNED["stops"])

    def test_asking_twice_gives_the_same_answers(self):
        self.assertEqual(digests(), self.digests)


_RUNS = {}


class FreshInterpreterTest(unittest.TestCase):
    def run_under(self, seed):
        if seed in _RUNS:
            return _RUNS[seed]
        _RUNS[seed] = self._run(seed)
        return _RUNS[seed]

    def _run(self, seed):
        environment = dict(os.environ)
        environment["PYTHONHASHSEED"] = seed
        finished = subprocess.run(
            [sys.executable, "-c", PROGRAM],
            capture_output=True,
            text=True,
            cwd=ROOT,
            env=environment,
        )
        self.assertEqual(finished.returncode, 0, finished.stderr)
        return finished.stdout.strip()

    def test_a_fresh_interpreter_agrees(self):
        import json

        self.assertEqual(json.loads(self.run_under("0")), PINNED)

    def test_two_hash_seeds_agree(self):
        self.assertEqual(self.run_under("0"), self.run_under("1"))

    def test_a_third_seed_agrees_too(self):
        self.assertEqual(self.run_under("12345"), self.run_under("0"))


if __name__ == "__main__":
    unittest.main()
