# The winder file

A winder file is what an engineer would have written on the back of the
certificate. Nothing in it is a figure somebody would have to calculate
first: every one of them is measured, ordered, or printed on a maker's
plate.

```
# Bolsover No.2, as converted to skip winding in 1961.

winder Bolsover No.2

shaft No.2 Downcast diameter=7.3m depth=942m conveyances=2 sump=15m headgear=42m

rope diameter=52mm construction=6x36 grade=1960 ropes=1

drum diameter=4.2m width=2.4m layers=2 lead=46m

rising skip the loaded skip tare=5.04t payload=12t decks=1 width=2.2m across=1.8m
falling skip the empty skip tare=5.04t payload=0t decks=1 width=2.2m across=1.8m

balance rate=9.94kg

cycle full=15mps accelerate=1 decelerate=1.1 creep=0.5mps creepfor=6m rest=25s

working hours=16h
```

Blank lines are ignored, and everything after a `#` on a line is a
comment. Every other line begins with a keyword; a word the reader does
not know is refused, and so is a key that keyword does not take. That
matters more than it sounds: a file with `dimeter` on the rope line is a
file whose rope is fifty-two millimetres because that is the default,
and the factor of safety that comes out of it is right for a rope that
is not on the machine.

## The keywords

| keyword    | takes                                                                    | how many |
| ---------- | ------------------------------------------------------------------------ | -------- |
| `winder`   | a name                                                                   | one      |
| `shaft`    | a name, then `diameter`, `depth`, `conveyances`, `sump`, `headgear`      | one      |
| `rope`     | `diameter`, `construction`, `grade`, `ropes`                             | one      |
| `drum`     | `diameter`, `width`, `layers`, `lead`                                    | one drive |
| `koepe`    | `diameter`, `wrap`, `friction`, `ropes`                                  | or the other |
| `rising`   | a kind and a name, then `tare`, `payload`, `decks`, `width`, `across`    | one      |
| `falling`  | the same                                                                  | one      |
| `balance`  | `rate`, in kilograms a metre                                             | none or one |
| `cycle`    | `full`, `accelerate`, `decelerate`, `creep`, `creepfor`, `rest`          | one      |
| `working`  | `hours`                                                                   | none or one |

The constructions are `6x19`, `6x36`, `6x7`, `locked` and `triangular`;
the kinds of conveyance are `cage`, `skip` and `counterweight`. Ask for
one that is not on the list and the reader says which are.

`drum` and `koepe` are the two ways of driving a rope and a file has
exactly one of them. A file with both is refused rather than the second
quietly winning. `examples/zollverein.winder` is a four-rope friction
winder and `examples/bolsover.winder` a single-rope drum one; the
difference between the two files is four lines.

## Units

Every quantity carries its unit and a quantity without one is refused,
except a share, which is written `40` as often as `40%` and whose
dimension is not in doubt.

| dimension        | units                              | canonical  |
| ---------------- | ---------------------------------- | ---------- |
| weight           | `kg`, `t`, `lt`, `cwt`             | kilograms  |
| length           | `m`, `mm`, `in`, `ft`, `yd`, `fm`  | metres     |
| speed            | `mps`, `fpm`, `kph`                | m/s        |
| power            | `kw`, `mw`, `hp`                   | kilowatts  |
| force            | `kn`, `n`, `tonf`                  | kilonewtons|
| time             | `s`, `min`, `h`                    | seconds    |
| rate             | `tph`, `tpd`                       | t/h        |
| share            | `%`                                | per cent   |

The fathom, the hundredweight, the long ton, the foot a minute and the
horsepower are there because the trade still speaks in them, and because
an engineman who knows a shaft as five hundred and fifteen fathoms
should not have to convert it before typing it in.

## What the reader will not do

It will not guess. A missing `rope` line is refused rather than
defaulted, two `winder` lines are refused rather than the second quietly
winning, and a rope line with no diameter is refused rather than taking
one. Every refusal carries the line number, because a certificate with
twenty lines on it and one mistake is otherwise a puzzle.

## Reading one

```
sheave winder examples/bolsover.winder --year
sheave winder examples/zollverein.winder
sheave checks examples/bolsover.winder
sheave audit  examples/wheal-jane.winder
sheave cost   examples/bolsover.winder --bars
sheave works  examples/bolsover.winder
```

The first says what the installation is doing, the second whether every
figure is inside the band it was designed to be inside, the third what
is wrong with it, the fourth what it costs, and the fifth whether the
winder is the thing actually limiting the colliery — which it usually
is not.
