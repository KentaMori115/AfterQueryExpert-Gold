# The scheme plan language

A scheme plan is a text file, conventionally with a `.sbx` extension. It has one
declaration to a line, comments run from `#` to the end of the line, and the
order of declarations does not matter.

Every example below is parsed by the test suite, so none of them can go stale.

## The header

```sbx
scheme kingsmoor {
    area "Kingsmoor Junction"
    prefix K
}
```

`area` is the name a person would use. `prefix` is the letter every signal in
the scheme is expected to start with, and the `layout-naming` rule checks it.

## Design figures

```sbx
standards {
    overlap 200
    reduced_overlap 46
    braking 0.45
    reaction 4
    flank 500
    approach 120
    throw 6
    route_limit 8000
}
```

Anything left out keeps its default. The checks run against these figures, so a
scheme drawn to a two hundred metre overlap is not reported for having one.

## Track

The layout is a graph. Nodes join edges together; edges are the track.

```sbx
node WD boundary
node ED boundary
node J1 plain
node P101 points throw 8 motor electric lock yes
node BAY buffer

edge D1 from WD to J1 length 560 speed 90 gradient 1 in 330 direction down
edge D2 from J1 to P101.toe length 40 speed 90 direction down
edge D3 from P101.normal to ED length 700 speed 90 direction down
edge D4 from P101.reverse to BAY length 200 speed 15 direction bidirectional
```

There are five kinds of node:

| Kind | Ends | What it is |
| --- | --- | --- |
| `boundary` | 1 | Where the scheme stops and somebody else's begins |
| `buffer` | 1 | A dead end |
| `plain` | 2 | A joint between two pieces of track |
| `points` | 3 | `toe`, `normal` and `reverse` |
| `crossing` | 4 | A diamond, `a1` and `a2` crossing `b1` and `b2` |
| `slip` | 4 | A crossing with points in it, same four ends |

A `slip` lying normal is a plain crossing. Lying reverse it joins `a1` to `b1`,
and a double slip joins `a2` to `b2` as well:

```sbx
node A boundary
node B boundary
node C boundary
node D boundary
node X slip double yes
edge S1 from A to X.a1 length 200 direction bidirectional
edge S2 from X.a2 to B length 200 direction bidirectional
edge S3 from C to X.b1 length 200 direction bidirectional
edge S4 from X.b2 to D length 200 direction bidirectional
```

Every edge is drawn in the direction of down traffic. `direction down` means the
track is worked that way only, `direction up` means the other way only, and
`direction bidirectional` means both. A gradient is written the way it is spoken:
`1 in 330` rises, `1 in -220` falls, and `level` is level.

## Detection

```sbx
node A boundary
node B boundary
node C boundary
node D boundary
edge E1 from A to B length 400
edge E2 from C to D length 400

section TA over E1
section TB counted over E2
```

A section is one track circuit, or one axle counter section if it says
`counted`. Every edge should be in exactly one.

## Signals

```sbx
node A boundary
node B boundary
edge E1 from A to B length 800 speed 60 direction bidirectional
section TA over E1

signal K1 on E1 at 800 facing forward direction down aspects 4 sighting 300
signal K2 on E1 at 0 facing backward direction up aspects 3
signal K20 on E1 at 400 facing forward aspects 2 type shunt
signal K5 on E1 at 600 facing forward direction down aspects 4 automatic yes
```

`facing forward` means the signal reads towards the end of the edge it stands
on, `facing backward` towards the start. `direction` is the traffic direction,
which is a label rather than geometry. A signal stands at a joint, so it is
usually at offset `0` or at the far end of its edge.

Signals take `type main`, `type shunt` or `type banner`, and the flags
`subsidiary yes` for a call on arm and `warning yes` for a warning arrangement.

`automatic yes` says the signal is not on the panel. Nobody sets its route: the
route stands set, the signal follows the track in front of it, and a signaller
who wants it back has only the replacement control. A signal worked that way has
to have one route and nothing to move, so it is a main signal on plain line;
anything else is a mistake in the plan and `check` says which.

## Level crossings and traps

```sbx
node A boundary
node B boundary
edge E1 from A to B length 900 speed 45 direction down
section TA over E1

crossing LC21 on E1 at 400 type mcb strike_in 30
trap TP1 on E1 at 800 facing backward
```

Crossings take `type mcb`, `mcb_od`, `ahb`, `uwc` or `open`. A trap catches a
movement running the way it faces.

## Splitting a plan up

```sbx
include "area.sbx"
```

The named file is read relative to the file that includes it, and everything it
declares is merged in. The whole lot is validated once at the end, so a signal
in one file may stand on an edge declared in another.
