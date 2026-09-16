"""Scripted simulations, so that a scheme can be regression tested.

A scenario is a list of things to do at particular times and a list of things
that should be true at the end. It is a text file next to the scheme plan, and
running it is the closest this gets to testing an interlocking the way it would
be tested on a panel.

    scenario "down train through the junction" {
        step 1
        until 400
    }

    at 0   train 1A05 on D1 at 100 length 80 facing forward
    at 1   book 1A05 "K1(M)" "K3(MA)"
    at 5   set "K1(M)"
    at 10  set "K3(MA)"
    at 60  fail P101
    at 90  release "K1(M)"

    expect train 1A05 on D5
    expect train 2B10 gone
    expect signal K1 shows G
    expect section TA clear
    expect points P101 status failed
    expect route "K1(M)" is available
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from ..errors import ParseError
from ..layout.tokens import Kind, Token, tokenize
from ..signalling.signal import Aspect
from ..sim.ars import Ars
from ..sim.log import EventKind
from ..sim.machine import Machine
from ..sim.regulator import Class
from ..sim.train import Train
from ..sim.world import World
from ..topology.graph import Sense
from ..topology.position import Position
from ..topology.scheme import Scheme
from ..units import Distance, Speed

ASPECT_WORDS = {
    "R": Aspect.RED,
    "Y": Aspect.YELLOW,
    "YY": Aspect.DOUBLE_YELLOW,
    "G": Aspect.GREEN,
}


@dataclass(frozen=True)
class Command:
    """Something the scenario does at a given time."""

    at: float
    verb: str
    args: tuple[str, ...]

    def __str__(self) -> str:
        return f"at {self.at:.0f} {self.verb} {' '.join(self.args)}"


@dataclass(frozen=True)
class Expectation:
    """Something the scenario says should be true when it finishes."""

    subject: str
    args: tuple[str, ...]

    def __str__(self) -> str:
        return f"expect {self.subject} {' '.join(self.args)}"


@dataclass
class Scenario:
    name: str = "unnamed"
    step: float = 1.0
    until: float = 300.0
    #: The time the last ``at`` line named, so that ``at +10`` can follow it.
    last_time: float = 0.0
    commands: list[Command] = field(default_factory=list)
    expectations: list[Expectation] = field(default_factory=list)

    def due(self, from_time: float, to_time: float) -> list[Command]:
        return [c for c in self.commands if from_time <= c.at < to_time]


def _time(word: str, scenario: Scenario, fail: Callable[[str], ParseError]) -> float:
    """Read a time, which may be absolute or ``+`` so many seconds after the last."""
    try:
        if word.startswith("+"):
            return scenario.last_time + float(word[1:])
        return float(word)
    except ValueError:
        raise fail(f"{word!r} is not a time") from None


class _Reader:
    """A cursor over the tokens of a scenario file.

    The scheme plan parser is a class for the same reason: a hand rolled parser
    written as one function ends up passing its position around by closure,
    which is fine until somebody has to change it.
    """

    def __init__(self, text: str, source: str) -> None:
        self.tokens = tokenize(text, source=source)
        self.source = source
        self.pos = 0

    @property
    def current(self) -> Token:
        return self.tokens[self.pos]

    def fail(self, message: str) -> ParseError:
        return ParseError(message, source=self.source, line=self.current.line)

    def at(self, kind: Kind) -> bool:
        return self.current.kind is kind

    def advance(self) -> Token:
        token = self.current
        if token.kind is not Kind.EOF:
            self.pos += 1
        return token

    def word(self) -> str:
        token = self.current
        if token.kind not in (Kind.IDENT, Kind.STRING, Kind.NUMBER):
            raise self.fail(f"expected a word, found {token}")
        self.pos += 1
        return token.text

    def number(self, called: str) -> float:
        raw = self.word()
        try:
            return float(raw)
        except ValueError:
            raise self.fail(f"{called} wants a number, found {raw!r}") from None

    def rest_of_line(self) -> tuple[str, ...]:
        found = []
        while self.current.kind not in (Kind.NEWLINE, Kind.EOF):
            found.append(self.word())
        return tuple(found)

    def skip_newlines(self) -> None:
        while self.at(Kind.NEWLINE):
            self.advance()


def _read_header(reader: _Reader, scenario: Scenario) -> None:
    """``scenario "a name" { step 2 until 400 }``"""
    reader.advance()
    scenario.name = reader.word()
    if not reader.at(Kind.LBRACE):
        raise reader.fail("a scenario block needs braces")
    reader.advance()

    reader.skip_newlines()
    while not reader.at(Kind.RBRACE):
        key = reader.word()
        if key not in ("step", "until"):
            raise reader.fail(f"unknown scenario setting {key!r}")
        value = reader.number(key)
        if key == "step":
            scenario.step = value
        else:
            scenario.until = value
        reader.skip_newlines()
    reader.advance()


def _read_command(reader: _Reader, scenario: Scenario) -> None:
    """``at 10 set "K1(M)"``, or ``at +10`` for ten seconds after the last."""
    reader.advance()
    when = _time(reader.word(), scenario, reader.fail)
    scenario.last_time = when
    verb = reader.word()
    scenario.commands.append(Command(when, verb, reader.rest_of_line()))


def _read_expectation(reader: _Reader, scenario: Scenario) -> None:
    """``expect train 1A05 on D5``"""
    reader.advance()
    subject = reader.word()
    scenario.expectations.append(Expectation(subject, reader.rest_of_line()))


#: The three kinds of line a scenario file has.
LINES = {
    "scenario": _read_header,
    "at": _read_command,
    "expect": _read_expectation,
}


def parse_scenario(text: str, *, source: str = "<string>") -> Scenario:
    """Read a scenario file."""
    reader = _Reader(text, source)
    scenario = Scenario()

    while not reader.at(Kind.EOF):
        if reader.at(Kind.NEWLINE):
            reader.advance()
            continue
        token = reader.current
        if token.kind is not Kind.IDENT:
            raise reader.fail(f"expected a line to start with a word, found {token}")
        read = LINES.get(token.text)
        if read is None:
            raise reader.fail(f"unknown line {token.text!r}")
        read(reader, scenario)

    return scenario


@dataclass
class Result:
    """What happened when a scenario was run."""

    scenario: Scenario
    world: World
    failures: list[str] = field(default_factory=list)
    ars: Ars | None = None

    @property
    def passed(self) -> bool:
        return not self.failures

    def summary(self) -> str:
        if self.passed:
            return f"{self.scenario.name}: passed"
        return f"{self.scenario.name}: {len(self.failures)} failed"


def run_scenario(scheme: Scheme, scenario: Scenario, world: World | None = None) -> Result:
    """Run a scenario against a scheme and check what it asked for."""
    from ..signalling.interlocking import build_interlocking

    world = world or World(scheme, Machine(scheme, build_interlocking(scheme)))
    ars = Ars(world)
    result = Result(scenario, world, ars=ars)

    pending = sorted(scenario.commands, key=lambda command: command.at)
    next_command = 0
    while True:
        while next_command < len(pending) and pending[next_command].at <= world.clock:
            _apply(world, [pending[next_command]], result)
            next_command += 1
        if world.clock >= scenario.until:
            break
        ars.step()
        world.step(scenario.step)

    for expectation in scenario.expectations:
        problem = _check(world, expectation)
        if problem:
            result.failures.append(problem)
    return result


def _apply(world: World, commands: list[Command], result: Result) -> None:
    for command in commands:
        try:
            problem = _do(world, command, result.ars)
        except (KeyError, IndexError, ValueError) as exc:
            problem = str(exc).strip("'")
        if problem:
            result.failures.append(f"{command}: {problem}")


#: A command handler. It is given the world, the words after the verb and the
#: route setting, and returns a complaint or None if it did what it was asked.
Handler = Callable[[World, tuple[str, ...], "Ars | None"], "str | None"]


def _needs(args: tuple[str, ...], count: int, shape: str) -> str | None:
    return None if len(args) >= count else f"expected: {shape}"


def _do_book(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del world
    if ars is None:
        return "nothing to book routes with"
    if problem := _needs(args, 2, "book TRAIN ROUTE [ROUTE ...]"):
        return problem
    klass = Class.from_word(args[1])
    if klass is None:
        ars.book(args[0], list(args[1:]))
        return None
    if problem := _needs(args, 3, "book TRAIN CLASS ROUTE [ROUTE ...]"):
        return problem
    ars.book(args[0], list(args[2:]), klass)
    return None


def _do_train(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    return _add_train(world, args)


def _do_set(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    if problem := _needs(args, 1, "set ROUTE"):
        return problem
    return None if world.request(args[0]) else f"could not set {args[0]}"


def _do_cancel(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    if problem := _needs(args, 1, "cancel ROUTE"):
        return problem
    return None if world.cancel(args[0]) else f"could not cancel {args[0]}"


def _do_release(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    if problem := _needs(args, 1, "release ROUTE"):
        return problem
    return None if world.emergency_release(args[0]) else f"could not release {args[0]}"


def _do_remove(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    if problem := _needs(args, 1, "remove TRAIN"):
        return problem
    world.remove(args[0])
    return None


def _do_note(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    world.note(EventKind.NOTE, "scenario", " ".join(args) or "(nothing)")
    return None


def _do_stop(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    if problem := _needs(args, 1, "stop TRAIN"):
        return problem
    if args[0] not in world.trains:
        return f"no train called {args[0]} to stop"
    world.stop_train(args[0])
    return None


def _do_reverse(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    if problem := _needs(args, 1, "reverse TRAIN"):
        return problem
    if args[0] not in world.trains:
        return f"no train called {args[0]} to reverse"
    return None if world.reverse(args[0]) else f"{args[0]} could not reverse"


def _do_fail(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    if problem := _needs(args, 1, "fail POINTS, SECTION or SIGNAL"):
        return problem
    return _fail_something(world, args[0])


def _do_restore(world: World, args: tuple[str, ...], ars: Ars | None) -> str | None:
    del ars
    if problem := _needs(args, 1, "restore POINTS, SECTION or SIGNAL"):
        return problem
    return _restore_something(world, args[0])


#: Every verb the scenario language has, and what does it.
COMMANDS: dict[str, Handler] = {
    "book": _do_book,
    "cancel": _do_cancel,
    "fail": _do_fail,
    "note": _do_note,
    "release": _do_release,
    "remove": _do_remove,
    "restore": _do_restore,
    "reverse": _do_reverse,
    "set": _do_set,
    "stop": _do_stop,
    "train": _do_train,
}


def _do(world: World, command: Command, ars: Ars | None = None) -> str | None:
    """Do one command, or say why it could not be done."""
    handler = COMMANDS.get(command.verb)
    if handler is None:
        return f"unknown command {command.verb!r}"
    return handler(world, command.args, ars)


def _fail_something(world: World, name: str) -> str | None:
    """Fail whatever is called this, whether it is points or a track circuit."""
    if name in world.machine.state.points:
        world.fail_points(name)
        return None
    if name in world.scheme.sections:
        world.fail_section(name)
        return None
    if name in world.scheme.signals:
        world.fail_signal(name)
        return None
    return f"nothing called {name} to fail"


def _restore_something(world: World, name: str) -> str | None:
    if name in world.machine.state.points:
        world.restore_points(name)
        return None
    if name in world.scheme.sections:
        world.restore_section(name)
        return None
    if name in world.scheme.signals:
        world.relight_signal(name)
        return None
    return f"nothing called {name} to restore"


#: Which way a train is pointing, written the way a signal facing is.
FACING = {"forward": Sense.NOMINAL, "backward": Sense.REVERSE}


def _add_train(world: World, args: tuple[str, ...]) -> str | None:
    if len(args) < 4 or args[1] != "on" or args[3] != "at":
        return "expected: train NAME on EDGE at OFFSET"
    name, edge, offset = args[0], args[2], float(args[4])
    options = dict(zip(args[5::2], args[6::2], strict=False))

    word = options.get("facing", "forward")
    sense = FACING.get(word)
    if sense is None:
        return f"{word!r} is not a facing, use forward or backward"

    train = Train(
        name=name,
        front=Position(edge, Distance(offset), sense),
        length=Distance(float(options.get("length", 80))),
        speed=Speed.from_mph(float(options.get("speed", 0))),
    )
    world.add(train)
    return None


#: An expectation handler, given the words after the subject.
Check = Callable[[World, tuple[str, ...]], "str | None"]


def _check_train(world: World, args: tuple[str, ...]) -> str | None:
    if problem := _needs(args, 2, "expect train NAME gone|on EDGE|facing WAY"):
        return problem
    name, what = args[0], args[1]
    train = world.trains.get(name)

    if what == "gone":
        return None if train is None else f"train {name} is still on {train.front.edge}"
    if train is None:
        return f"train {name} is not on the layout"
    if problem := _needs(args, 3, f"expect train NAME {what} VALUE"):
        return problem

    if what == "on":
        found = train.front.edge
        return None if found == args[2] else f"train {name} is on {found}, expected {args[2]}"
    if what == "facing":
        found = "forward" if train.front.sense is Sense.NOMINAL else "backward"
        return None if found == args[2] else f"train {name} faces {found}, expected {args[2]}"
    return f"do not know how to check a train {what!r}"


def _check_signal(world: World, args: tuple[str, ...]) -> str | None:
    if problem := _needs(args, 2, "expect signal NAME dark|shows ASPECT"):
        return problem
    name, what = args[0], args[1]

    if what == "dark":
        return None if world.machine.state.is_dark(name) else f"{name} is lit"
    if what != "shows":
        return f"do not know how to check a signal {what!r}"
    if problem := _needs(args, 3, "expect signal NAME shows ASPECT"):
        return problem

    wanted = ASPECT_WORDS.get(args[2].upper())
    if wanted is None:
        return f"{args[2]} is not an aspect"
    showing = world.machine.showing(name)
    return None if showing is wanted else f"{name} shows {showing}, expected {wanted}"


def _check_points(world: World, args: tuple[str, ...]) -> str | None:
    if problem := _needs(args, 3, "expect points NAME lying|status VALUE"):
        return problem
    name, what, value = args[0], args[1], args[2]
    points = world.machine.state.point(name)

    if what == "lying":
        found = points.lie.value
        return None if found == value else f"{name} lies {found}, expected {value}"
    if what == "status":
        found = points.status.value
        return None if found == value else f"{name} is {found}, expected {value}"
    return f"do not know how to check points {what!r}"


def _check_route(world: World, args: tuple[str, ...]) -> str | None:
    if problem := _needs(args, 3, "expect route NAME is STATUS"):
        return problem
    name, what, value = args[0], args[1], args[2]
    if what != "is":
        return f"do not know how to check a route {what!r}"
    found = world.machine.state.route(name).status.value
    return None if found == value else f"{name} is {found}, expected {value}"


def _check_section(world: World, args: tuple[str, ...]) -> str | None:
    if problem := _needs(args, 2, "expect section NAME occupied|clear|failed"):
        return problem
    name, what = args[0], args[1]
    state = world.machine.state

    if what == "failed":
        return None if state.has_failed(name) else f"{name} has not failed"
    occupied = state.is_occupied(name)
    if what == "occupied":
        return None if occupied else f"{name} is clear, expected occupied"
    if what == "clear":
        return None if not occupied else f"{name} is occupied, expected clear"
    return f"do not know how to check a section {what!r}"


#: Every kind of thing a scenario can expect something of.
CHECKS: dict[str, Check] = {
    "points": _check_points,
    "route": _check_route,
    "section": _check_section,
    "signal": _check_signal,
    "train": _check_train,
}


def _check(world: World, expectation: Expectation) -> str | None:
    """Check one expectation, or say how it was not met."""
    check = CHECKS.get(expectation.subject)
    if check is None:
        return f"unknown expectation {expectation.subject!r}"
    return check(world, expectation.args)
