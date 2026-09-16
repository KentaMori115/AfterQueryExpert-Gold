"""What each rule is actually about, and what to do when it fires.

A code and a one line title are enough to find a finding again. They are not
enough for somebody who has just been handed the scheme and wants to know
whether the finding matters. This is the long form: why the rule exists and what
the usual answers are.

Keeping it in one file rather than in the rules themselves is deliberate. The
rules are short because they should be, and the wording here gets argued over
and changed far more often than the code does.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Guidance:
    """The long form for one rule."""

    code: str
    why: str
    fix: str

    def text(self) -> str:
        return f"{self.code}\n\n  why:  {self.why}\n\n  fix:  {self.fix}\n"

    def __str__(self) -> str:
        return self.text()


def _g(code: str, why: str, fix: str) -> tuple[str, Guidance]:
    return code, Guidance(code, why, fix)


GUIDANCE: dict[str, Guidance] = dict(
    [
        _g(
            "flank-open",
            "Something can run into the side of this route and nothing stops it.",
            "Lay a set of points away from the route, put a trap in, or hold a "
            "signal at danger. If none of those are possible the move has to be "
            "worked another way.",
        ),
        _g(
            "flank-signal",
            "The only thing keeping a movement off the side of this route is a "
            "signal at danger, and a signal can be passed.",
            "Where the layout allows it, call a set of points away from the "
            "route as well. Where it does not, this is usually accepted.",
        ),
        _g(
            "flank-shared",
            "Two routes want the same points lying opposite ways for flank "
            "protection, so one of them can never be set.",
            "One of the two routes is protected the wrong way round. Work out "
            "which movement each is protecting against.",
        ),
        _g(
            "overlap-missing",
            "There is no track beyond the exit signal to hold as an overlap.",
            "Either the signal is in the wrong place or the route should end somewhere else.",
        ),
        _g(
            "overlap-short",
            "The overlap is shorter than the scheme's standard, so a train that "
            "overruns has less room than the design assumes.",
            "Move the signal, reduce the approach speed, or accept the short "
            "overlap and record why.",
        ),
        _g(
            "overlap-swing",
            "The overlap can be held two ways, which is normal at a junction and "
            "worth knowing about because it changes what else can be set.",
            "Nothing, unless the swinging was not intended.",
        ),
        _g(
            "spacing-short",
            "A driver braking from line speed cannot stop at the signal ahead.",
            "Move a signal, add one in between, or bring the line speed down.",
        ),
        _g(
            "spacing-heads",
            "A three aspect signal behind a four aspect one loses a block of "
            "warning without anybody noticing.",
            "Give the signal in rear the extra head, or accept the shorter "
            "warning and check the braking distance holds.",
        ),
        _g(
            "detection-gap",
            "There is track no section covers, so the interlocking cannot see a train on it.",
            "Extend a section over it or add one.",
        ),
        _g(
            "detection-long",
            "A very long section releases a long way behind the train, which costs capacity.",
            "Split it, if the traffic is worth the equipment.",
        ),
        _g(
            "detection-joint",
            "A signal a long way from a joint means the section behind it is not "
            "a berth, so the signal cannot be replaced behind a train promptly.",
            "Move the joint to the signal.",
        ),
        _g(
            "aspect-clamp",
            "The aspect sequence wants an aspect this signal has not got the heads to show.",
            "Add a head, or accept that the driver gets a more restrictive "
            "aspect than the sequence intends.",
        ),
        _g(
            "aspect-dark",
            "No route reads from this signal, so it can never clear.",
            "Usually the direction of working on the track it stands on is "
            "wrong, or the signal is facing the wrong way.",
        ),
        _g(
            "aspect-junction",
            "A diverging route much slower than the line, with nothing to make "
            "the driver slow down for it.",
            "Approach control the junction signal from red, or fit a flashing aspect sequence.",
        ),
        _g(
            "locking-headon",
            "Two routes can be set over the same track in opposite directions.",
            "This is a bug in the interlocking data. It has to be fixed, not accepted.",
        ),
        _g(
            "locking-split",
            "A route asks for the same points two ways at once, so it can never be set.",
            "Its flank or overlap requirement contradicts the route itself.",
        ),
        _g(
            "locking-bottleneck",
            "One route locks out most of the scheme, so setting it stops everything else.",
            "Often unavoidable at a single lead junction. Worth knowing before "
            "the timetable is written.",
        ),
        _g(
            "points-lock",
            "Facing points with no lock on the blades under a passenger move.",
            "Fit a facing point lock. There is no other answer.",
        ),
        _g(
            "points-hand",
            "Routes are signalled over points the interlocking cannot move.",
            "Either the points get a machine or the moves over them stop being signalled.",
        ),
        _g(
            "points-slow",
            "Slow points hold up every route that calls them.",
            "A faster machine, or accept the setting time.",
        ),
        _g(
            "points-unused",
            "Nothing runs over these points, holds them, or calls them for flank.",
            "Usually a leftover from an earlier stage of the drawing.",
        ),
        _g(
            "gradient-falling",
            "The route falls into its signal, so a driver braking for it is "
            "getting no help from the gradient at the point it matters most.",
            "Nothing, usually. It is worth knowing when the spacing is tight.",
        ),
        _g(
            "gradient-steep",
            "The route runs over a gradient steep enough that a train stopped on "
            "it may not be able to restart.",
            "Check the traffic that will use it, and whether it can be stopped "
            "there by signals.",
        ),
        _g(
            "gradient-summit",
            "The road rises and then falls inside the route, so a stalling train "
            "ends up at the summit rather than anywhere convenient.",
            "Nothing, unless the summit is somewhere a train would be held.",
        ),
        _g(
            "layout-stranded",
            "No train can reach this track from a boundary.",
            "Check the direction of working, and check the ports the edges join.",
        ),
        _g(
            "layout-deadend",
            "A train can get into this siding and the direction of working will "
            "not let it out.",
            "Make the siding bidirectional.",
        ),
        _g(
            "layout-naming",
            "A signal that does not follow the scheme prefix will end up being "
            "called two different things in two different documents.",
            "Rename it, or change the prefix.",
        ),
        _g(
            "layout-numbering",
            "Down signals are conventionally odd and up signals even.",
            "Renumber, unless the scheme has its own convention.",
        ),
        _g(
            "crossing-warning",
            "An automatic crossing whose strike in point is too close to give "
            "road users their warning time.",
            "Move the strike in point back, or bring the line speed down.",
        ),
        _g(
            "crossing-open",
            "An open or user worked crossing on fast line.",
            "These are usually closed or upgraded rather than accepted.",
        ),
        _g(
            "crossing-route",
            "The route proves a crossing before its signal will clear.",
            "Nothing, this is a note of what the route does.",
        ),
        _g(
            "tpws-missing",
            "A main signal with no overspeed grid, so a train can arrive too "
            "fast to stop at it.",
            "Fit one, or record why the approach speed makes it unnecessary.",
        ),
        _g(
            "tpws-room",
            "The overspeed grid would have to go further back than the signal in "
            "rear, where it would catch trains that are not going anywhere near "
            "the signal it protects.",
            "Raise the set speed, or accept a grid nearer the signal and record the shortfall.",
        ),
        _g(
            "berth-missing",
            "There is nowhere for a train waiting at this signal to be seen.",
            "Add a section behind the signal.",
        ),
        _g(
            "berth-shared",
            "Two signals berth in the same section, so the describer cannot tell "
            "which of them a train is standing at.",
            "Split the section, or accept it where the two signals are never occupied at once.",
        ),
        _g(
            "route-none",
            "This signal has no route, so it can never do anything but stop trains.",
            "Check what is in front of it and which way it faces.",
        ),
        _g(
            "route-duplicate",
            "The same move is signalled twice under two names.",
            "One of the two is redundant.",
        ),
        _g(
            "route-long",
            "A route much longer than its neighbours, which is usually a signal "
            "that has not been drawn yet.",
            "Add a signal, or accept the longer block and its headway.",
        ),
        _g(
            "route-shunt",
            "A shunt move over track faster than shunting speed.",
            "Usually the speed on the plan is the running speed and the shunt "
            "move has its own lower limit.",
        ),
        _g(
            "setting-refused",
            "The interlocking will not set this route with nothing in the way.",
            "The reason is printed with the finding, and it is always something "
            "the data says rather than something the layout does.",
        ),
        _g(
            "setting-clears",
            "The route sets but the signal stays at danger with a clear road.",
            "Check the points the route calls and the track it holds.",
        ),
        _g(
            "setting-pairs",
            "The control table says two routes are compatible and the machine "
            "refuses to set them together.",
            "One of the two is wrong. Fix the disagreement before anything else.",
        ),
        _g(
            "sighting-short",
            "The signal cannot be seen for long enough to be read and acted on.",
            "Move it, clear the sighting, fit a banner repeater, or bring the "
            "approach speed down.",
        ),
        _g(
            "sighting-unmeasured",
            "Nobody has recorded how far this signal can be seen from.",
            "Measure it on site and put the figure in the plan.",
        ),
        _g(
            "sighting-nonsense",
            "The sighting distance in the plan is not a number.",
            "Correct the plan.",
        ),
        _g(
            "capacity-worst",
            "One block is much worse than the rest, so it sets the headway of the whole line.",
            "Split it, or accept the headway.",
        ),
        _g(
            "capacity-target",
            "The line does not meet the headway it was drawn for.",
            "Shorter blocks, more aspects, or a different timetable.",
        ),
        _g(
            "capacity-heads",
            "Three aspect signalling on fast line, where a fourth head would buy "
            "capacity back.",
            "Add the head, if the traffic justifies it.",
        ),
        _g(
            "reversible-unused",
            "Track marked as worked both ways that only has moves signalled over "
            "it one way, which is expensive equipment doing nothing.",
            "Either signal the moves the other way or mark the track one way.",
        ),
        _g(
            "reversible-direction",
            "A signal on one way track reading against the way the track is "
            "worked, which means it can never be cleared.",
            "Turn the signal round or change the direction on the edge.",
        ),
        _g(
            "standards-braking",
            "The braking rate in the plan is not one a train could manage.",
            "Correct the figure. Every spacing check depends on it.",
        ),
        _g(
            "standards-overlap",
            "The standard overlap is shorter than the distance a train takes to "
            "stop from the speed it may pass the signal at.",
            "Lengthen it, or record why the approach is slower than assumed.",
        ),
        _g(
            "standards-flank",
            "The flank search is shorter than the layout, so protection that is "
            "there will be reported as missing.",
            "Raise the figure until it covers the longest edge.",
        ),
        _g(
            "standards-reduced",
            "The reduced overlap is longer than the standard one, so the two "
            "figures are the wrong way round.",
            "Swap the two figures over.",
        ),
    ]
)


def guidance_for(code: str) -> Guidance | None:
    return GUIDANCE.get(code)


def missing(codes: list[str]) -> list[str]:
    """Rules nobody has written guidance for yet."""
    return sorted(code for code in codes if code not in GUIDANCE)


def spare() -> list[str]:
    """Guidance for rules that no longer exist."""
    from .rules import registered

    codes = {rule.code for rule in registered()}
    return sorted(code for code in GUIDANCE if code not in codes)


def as_markdown() -> str:
    """The whole rule set as a document, generated so it cannot go stale."""
    from .rules import registered

    lines = [
        "# The rules",
        "",
        "Every rule `signalbox check` runs, what it is about, and what to do when",
        "it fires. This file is generated from the rules themselves by",
        "`signalbox rules --markdown`, so it is never out of date.",
        "",
        "| Code | Severity | Checks that |",
        "| --- | --- | --- |",
    ]
    lines.extend(f"| `{rule.code}` | {rule.severity} | {rule.title} |" for rule in registered())
    lines.append("")

    for rule in registered():
        found = GUIDANCE[rule.code]
        lines.append(f"## {rule.code}")
        lines.append("")
        lines.append(f"*{rule.severity}: {rule.title}*")
        lines.append("")
        lines.append(found.why)
        lines.append("")
        lines.append(f"**What to do:** {found.fix}")
        lines.append("")
    return "\n".join(lines)
