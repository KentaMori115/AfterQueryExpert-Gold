"""Follow performers from mark to mark across the moves of a production.

Paper Tech compiles each move's travel from the mark it names. This module
answers the question the compiler and the rehearsal both need instead: where
does the performer actually stand when a move starts? A performer stands at
their ``initial_mark`` until their first move finishes, then at the ``to`` of
each move they finish, and nowhere at all while one of their moves runs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping

from cueforge.codes import CF3005_MANUAL_UNRESOLVED, CF5004_BAD_MOVE
from cueforge.findings import Finding, Severity

__all__ = [
    "MarkOracle",
    "MoveRequest",
    "MoveRun",
    "ResolvedMove",
    "follow_moves",
    "move_order",
    "position_at",
    "resolve_moves",
]

# Far enough in the future for every move to have ended.
END_OF_SHOW = 2**63 - 1


@dataclass(frozen=True, slots=True)
class MoveRequest:
    """A move as authored, with the start the compiler resolved for it."""

    cue_id: str
    performer: str
    to: str
    stated_from: str | None
    start_ms: int | None


@dataclass(frozen=True, slots=True)
class ResolvedMove:
    """A move with the mark it really departs from and the duration that gives."""

    cue_id: str
    performer: str
    from_mark: str | None
    to: str
    start_ms: int | None
    duration_ms: int
    known: bool

    def end_ms(self) -> int | None:
        if self.start_ms is None:
            return None
        return self.start_ms + self.duration_ms


@dataclass(frozen=True, slots=True)
class MoveRun:
    """A move as a rehearsal ran it: compiled departure mark, actual instants."""

    cue_id: str
    performer: str
    from_mark: str | None
    to: str
    start_ms: int | None
    end_ms: int | None
    completed: bool


DurationRule = Callable[[MoveRequest, str | None], tuple[int, list[Finding]]]


def move_order(start_ms: int | None, cue_id: str) -> tuple[int, str]:
    """Moves are followed in start order, ties by cue id, like simultaneous events."""
    return (END_OF_SHOW if start_ms is None else start_ms, cue_id)


def _group(items: list, key: Callable) -> dict[str, list]:
    grouped: dict[str, list] = {}
    for item in items:
        grouped.setdefault(key(item), []).append(item)
    return grouped


def _running_finding(move: MoveRequest, running: str, until: int) -> Finding:
    return Finding(
        code=CF5004_BAD_MOVE,
        severity=Severity.ERROR,
        message=(
            f"cue {move.cue_id!r} moves {move.performer!r} while cue {running!r} "
            f"still moves them until {until}ms"
        ),
        subject_kind="cue",
        subject_id=move.cue_id,
        witness={"performer": move.performer, "running": running, "until_ms": until},
    )


def _disagree_finding(move: MoveRequest, actual: str) -> Finding:
    return Finding(
        code=CF5004_BAD_MOVE,
        severity=Severity.ERROR,
        message=(
            f"cue {move.cue_id!r} moves {move.performer!r} from {move.stated_from!r} "
            f"but they stand at {actual!r}"
        ),
        subject_kind="cue",
        subject_id=move.cue_id,
        witness={"performer": move.performer, "stated": str(move.stated_from), "actual": actual},
    )


def _unresolved_finding(move: MoveRequest) -> Finding:
    return Finding(
        code=CF3005_MANUAL_UNRESOLVED,
        severity=Severity.ERROR,
        message=(
            f"cue {move.cue_id!r} moves {move.performer!r} from an unknown position; "
            f"a move of theirs has no start until a GO, so state from"
        ),
        subject_kind="cue",
        subject_id=move.cue_id,
        witness={"performer": move.performer},
    )


def resolve_moves(
    moves: list[MoveRequest],
    initial_marks: Mapping[str, str],
    duration_for: DurationRule,
) -> tuple[dict[str, ResolvedMove], list[Finding]]:
    """Resolve where every move departs from, in start order per performer.

    ``duration_for`` turns a move and its departure mark into the compiled
    duration (travel, or the authored figure, under the compiler's rules) and
    any finding that raises. When a performer has a move without a start, no
    position of theirs can be known at compile time: every move of theirs
    must state ``from``, which is then used as authored.
    """
    resolved: dict[str, ResolvedMove] = {}
    findings: list[Finding] = []
    for performer, group in sorted(_group(moves, lambda m: m.performer).items()):
        known = all(move.start_ms is not None for move in group)
        if not known:
            for move in group:
                if move.stated_from is None:
                    findings.append(_unresolved_finding(move))
                duration, duration_findings = duration_for(move, move.stated_from)
                findings.extend(duration_findings)
                resolved[move.cue_id] = ResolvedMove(
                    move.cue_id, performer, move.stated_from, move.to,
                    move.start_ms, duration, False,
                )
            continue
        position = initial_marks.get(performer)
        running_until: int | None = None
        running_to: str | None = None
        running_id: str | None = None
        for move in sorted(group, key=lambda m: move_order(m.start_ms, m.cue_id)):
            assert move.start_ms is not None
            if running_until is not None and move.start_ms >= running_until:
                position = running_to
                running_until = None
            if running_until is not None and running_id is not None:
                findings.append(_running_finding(move, running_id, running_until))
                departs = running_to
            else:
                departs = position
            if move.stated_from is not None and departs is not None and move.stated_from != departs:
                findings.append(_disagree_finding(move, departs))
            duration, duration_findings = duration_for(move, departs)
            findings.extend(duration_findings)
            resolved[move.cue_id] = ResolvedMove(
                move.cue_id, performer, departs, move.to, move.start_ms, duration, True
            )
            running_until = move.start_ms + duration
            running_to = move.to
            running_id = move.cue_id
    return resolved, findings


def position_at(
    runs: list[MoveRun],
    initial: str | None,
    time_ms: int,
    exclude: str | None = None,
) -> str | None:
    """Where a performer stands at ``time_ms`` given their runs in start order.

    ``None`` means nowhere: one of their moves is running at that instant. A
    move that ended exactly at ``time_ms`` has finished (half-open, like a
    reservation). A failed move leaves the performer where it was.
    """
    position = initial
    arrived: tuple[int, str] | None = None
    for run in runs:
        if run.cue_id == exclude or run.start_ms is None:
            continue
        if run.start_ms > time_ms:
            break
        if run.end_ms is not None and time_ms < run.end_ms:
            return None
        if run.completed and run.end_ms is not None:
            # The move that finished last decides, whatever order they started in.
            key = (run.end_ms, run.cue_id)
            if arrived is None or key > arrived:
                arrived = key
                position = run.to
    return position


class MarkOracle:
    """Answers where each performer stands at any instant of a rehearsal."""

    def __init__(
        self,
        runs: list[MoveRun],
        initial_marks: Mapping[str, str],
        locations: Mapping[str, object],
    ) -> None:
        self._initial = dict(initial_marks)
        self._locations = set(locations)
        self._runs = {
            performer: sorted(group, key=lambda r: move_order(r.start_ms, r.cue_id))
            for performer, group in _group(runs, lambda r: r.performer).items()
        }

    def knows_performer(self, performer: str) -> bool:
        return performer in self._initial

    def knows_location(self, mark: str) -> bool:
        return mark in self._locations

    def mark_at(self, performer: str, time_ms: int, exclude: str | None = None) -> str | None:
        return position_at(
            self._runs.get(performer, []), self._initial.get(performer), time_ms, exclude
        )

    def final_marks(self) -> dict[str, str]:
        marks: dict[str, str] = {}
        for performer in sorted(self._initial):
            mark = self.mark_at(performer, END_OF_SHOW)
            marks[performer] = mark if mark is not None else self._initial[performer]
        return marks


def follow_moves(
    runs: list[MoveRun],
    initial_marks: Mapping[str, str],
    locations: Mapping[str, object],
) -> tuple[MarkOracle, list[Finding]]:
    """Check every run against where its performer stood when it started."""
    oracle = MarkOracle(runs, initial_marks, locations)
    findings: list[Finding] = []
    for run in sorted(runs, key=lambda r: move_order(r.start_ms, r.cue_id)):
        if run.start_ms is None or run.from_mark is None:
            continue
        actual = oracle.mark_at(run.performer, run.start_ms, exclude=run.cue_id)
        if actual == run.from_mark:
            continue
        findings.append(
            Finding(
                code=CF5004_BAD_MOVE,
                severity=Severity.ERROR,
                message=(
                    f"cue {run.cue_id!r} moves {run.performer!r} from {run.from_mark!r} "
                    f"but at {run.start_ms}ms they stand "
                    + ("nowhere" if actual is None else f"at {actual!r}")
                ),
                subject_kind="cue",
                subject_id=run.cue_id,
                witness={
                    "performer": run.performer,
                    "expected": run.from_mark,
                    "actual": "" if actual is None else actual,
                    "time_ms": run.start_ms,
                },
            )
        )
    return oracle, findings
