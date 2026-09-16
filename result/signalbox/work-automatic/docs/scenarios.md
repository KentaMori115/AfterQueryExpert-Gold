# The scenario language

A scenario is a script of things to do to a railway and things that should be
true when it has finished. It is a text file, conventionally `.sbs`, and it is
run against a scheme plan:

```
signalbox sim kingsmoor.sbx down-through-the-junction.sbs --log
signalbox graph kingsmoor.sbx down-through-the-junction.sbs --out graph.svg
signalbox panel kingsmoor.sbx down-through-the-junction.sbs --at 120
```

## The header

```sbs
scenario "down train to the branch" {
    step 2
    until 400
}
```

`step` is how many seconds pass between one tick of the simulation and the next,
and `until` is when it stops. A smaller step is more accurate and slower; two
seconds is fine for anything that is not about exactly where a train stopped.

## Doing things

Every line begins `at`, with the time in seconds:

```sbs
scenario x {
    step 2
    until 400
}

at 0   train 1A05 on D1 at 60 length 100 speed 25 facing forward
at 0   book 1A05 express "K1(M)" "K3(MB)"
at 10  set "K1(M)"
at 120 cancel "K1(M)"
at 130 release "K1(M)"
at 200 fail P103
at 200 fail TB
at 200 fail K1
at 220 replace K5
at 240 automatic K5
at 260 restore P103
at 300 stop 1A05
at 302 reverse 1A05
at 380 remove 1A05
```

| Command | What it does |
| --- | --- |
| `train` | Puts a train on the layout. `length`, `speed` and `facing` are optional |
| `book` | Gives a train the routes it is booked over, for automatic route setting |
| `set` | Asks for a route, as a signaller would |
| `cancel` | Gives a route up, waiting out the approach locking if anything is coming |
| `release` | Emergency release, which waits out its own timer whatever the track says |
| `fail` | Fails a set of points, a track circuit or a signal, whichever the name is |
| `restore` | Puts one of those right again |
| `replace` | Puts an automatic signal back to danger and keeps it there |
| `automatic` | Gives a replaced signal back to the trains |
| `stop` | Brings a train to a stand where it is |
| `reverse` | Turns a stopped train round |
| `remove` | Takes a train off the layout |
| `note` | Writes a line into the log, for whoever reads it afterwards |

A time may be written `+10`, meaning ten seconds after the last line:

```sbs
scenario x {
    step 2
    until 200
}

at 0   train 1A05 on D1 at 60 speed 25
at +10 note the train is away
at +20 set "K1(M)"
```

Route names contain brackets, so they have to be quoted. A train name does not.

A booking may name the class of train, which is what the regulator uses to
decide who goes first when two of them want the same junction:

```sbs
scenario x {
    step 2
    until 100
}

at 0 train 1A05 on D1 at 60
at 0 book 1A05 express "K1(M)"
at 0 book 2B10 stopper "K2(M)"
```

## Expecting things

Expectations are checked once, when the run finishes:

```sbs
scenario x {
    step 2
    until 400
}

at 0 train 1A05 on D1 at 60

expect train 1A05 on D7
expect train 2B10 gone
expect train 1A05 facing backward
expect signal K1 shows R
expect signal K5 dark
expect signal K7 automatic
expect signal K9 replaced
expect points P101 lying reverse
expect points P103 status failed
expect route "K1(M)" is available
expect section TA clear
expect section TB occupied
expect section TC failed
```

A signal is `automatic` while the trains are working it and `replaced` while a
signaller is holding it back. An aspect is written `R`, `Y`, `YY` or `G`. A route status is one of
`available`, `called`, `set`, `occupied` or `releasing`.

Anything a command or an expectation cannot do is reported as a failure of the
scenario rather than raising, so a scenario with a typo in it fails with a line
saying what the typo was.
