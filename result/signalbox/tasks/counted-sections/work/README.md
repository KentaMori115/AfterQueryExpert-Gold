# signalbox

Interlocking design and verification for railway signalling schemes.

You give it a scheme plan. It works out the routes, the overlaps, the flank
protection and the locking, prints the control table, and tells you what is
wrong with the design before anybody builds it.

## The plan

A scheme plan is a text file. The layout is a graph: edges are pieces of plain
line, nodes are whatever joins them, and points are the nodes that can send a
train two ways.

```sbx
scheme kingsmoor {
    area "Kingsmoor Junction"
    prefix K
}

node WD boundary
node P103 points
node P101 points
node ED boundary

edge D1 from WD to P103.toe length 600 speed 90 gradient 1 in 330 direction down
edge D2 from P103.normal to P101.toe length 500 speed 90 direction down
edge D3 from P101.normal to ED length 700 speed 90 direction down

section TA over D1
section TB over D2
section TC over D3

signal K1 on D1 at 560 facing forward direction down aspects 4
signal K3 on D2 at 460 facing forward direction down aspects 3
```

Every edge is drawn in the direction of down traffic, so `facing forward` means
a signal reads the way the edge was written and `direction up` means the track
is worked the other way.

## What it does

```
signalbox show kingsmoor.sbx --detail      # what is in the plan
signalbox routes kingsmoor.sbx             # the routes it found
signalbox table kingsmoor.sbx -f csv       # the control table
signalbox points kingsmoor.sbx             # the same thing read points first
signalbox aspects kingsmoor.sbx            # what each signal will show
signalbox locking kingsmoor.sbx            # what each route holds
signalbox headway kingsmoor.sbx            # what service it will carry
signalbox check kingsmoor.sbx              # what is wrong with it
signalbox draw kingsmoor.sbx --legend      # a schematic
signalbox sim kingsmoor.sbx run.sbs --log  # run a scenario
signalbox graph kingsmoor.sbx run.sbs      # a train graph of the run
signalbox pack kingsmoor.sbx --out pack    # everything, for a handover
signalbox diff old.sbx new.sbx             # what changed
signalbox where kingsmoor.sbx TB           # what uses this section
signalbox heads kingsmoor.sbx              # where the counting heads go
signalbox distance kingsmoor.sbx K1 K3     # how far it is along the rails
signalbox chainage kingsmoor.sbx           # where everything is in miles and chains
signalbox export kingsmoor.sbx             # the interchange file
signalbox rules --explain flank-open       # why a rule is there
signalbox route kingsmoor.sbx "K1(M)"      # everything about one route
signalbox set kingsmoor.sbx "K1(M)"        # what the interlocking would do
signalbox panel kingsmoor.sbx run.sbs      # the panel at the end of a run
```

`check` runs a set of rules and exits non zero if any of them found an error.
The rules are the point of the whole thing: unprotected flanks, overlaps that
are short of standard, signals closer together than the braking distance at line
speed on the gradient that is actually there, track no section covers, aspect
sequences a three aspect signal cannot show, locking that contradicts itself,
facing points without a lock, level crossings that would not get their warning
time, and track no train can reach.

`check` takes a file of findings that have already been accepted, so that a new
one stands out:

```
signalbox check kingsmoor.sbx --accept > waivers.txt
signalbox check kingsmoor.sbx --waivers waivers.txt
signalbox check kingsmoor.sbx --format json
signalbox check kingsmoor.sbx --since last-build.json
signalbox check examples --strict
```

## Using it as a library

```python
import signalbox

scheme = signalbox.load("kingsmoor.sbx")
report = signalbox.check(scheme)

for finding in report.sorted():
    print(finding)

for row in signalbox.control_table(scheme):
    print(row.route, row.cell("track clear"))
```

## Design standards

Every figure the checks use is a decision somebody made, so a plan can say what
it was drawn to and be checked against that rather than against a default:

```sbx
standards {
    overlap 200
    braking 0.4
    flank 500
    approach 150
}
```

## Simulating it

A scenario is a script of things to do and things that should be true
afterwards. It is the closest this gets to testing an interlocking on a panel:

```sbs
scenario "down train to the branch" {
    step 2
    until 400
}

at 0 train 1A05 on D1 at 60 length 80 speed 20
at 0 book 1A05 express "K1(M)" "K3(MB)"
at 90 fail P103

expect train 1A05 on D7
expect signal K1 shows R
```

## How it is put together

| Layer | What it holds |
| --- | --- |
| `layout` | The scheme plan language: tokeniser, parser, validation |
| `topology` | The track graph, positions on it, and walking over it |
| `signalling` | Routes, overlaps, flanks, locking, approach control, aspects |
| `tables` | Control tables and points tables, rendered and diffed |
| `verify` | The rule engine and the rules |
| `sim` | Running the interlocking, with trains, drivers and scenarios |
| `render` | Schematics and train graphs |
| `interchange` | The file that gets handed over, and comparing two of them |
| `cli` | One module per command |

Nothing below `cli` touches the filesystem except `layout.loader`, and nothing
in `topology` or `signalling` knows what a terminal is.

## Documentation

| File | What is in it |
| --- | --- |
| [docs/language.md](docs/language.md) | The scheme plan language, declaration by declaration |
| [docs/scenarios.md](docs/scenarios.md) | The scenario language, command by command |
| [docs/design.md](docs/design.md) | How the package is put together and why |
| [docs/rules.md](docs/rules.md) | Every rule, why it is there and what to do about it |
| [CHANGELOG.md](CHANGELOG.md) | What changed and when |

`docs/rules.md` is generated by `signalbox rules --markdown`, and the tests fail
if it has drifted from the rules.

## Running the tests

```
make install
make check
```

`make check` is the linter, the type checker and the tests. There is nothing
else to remember.
