# Two corners held back for a difficulty round

Neither needs a word added to the instruction: both are already covered by
"out of balance runs from `leastOutOfBalance` to `mostOutOfBalance` across a
wind, both signed". They exist because the shipped fixtures all have the most
at the start of the wind and the least at the end, which is what an
implementation that hardcodes `atStart` and `atEnd` would assume.

## A balance rope heavier than the winding rope

    winder Ashington B
    shaft Bothal diameter=6.4m depth=760m conveyances=2 sump=12m headgear=36m
    rope diameter=44mm construction=6x36 grade=1960 ropes=1
    drum diameter=3.6m width=2m layers=2 lead=32m
    rising skip loaded tare=4.2t payload=10t decks=1 width=2.1m across=1.7m
    falling skip empty tare=4.2t payload=0t decks=1 width=2.1m across=1.7m
    balance rate=24kg
    cycle full=12mps accelerate=1 decelerate=1.1 creep=0.5mps creepfor=6m rest=22s
    brake path=3.2m width=0.24m arc=55 shoes=4 friction=0.35 force=260kn

The out-of-balance runs backwards: `atStart` is -27.76 kN and `atEnd` is
223.90, so the **most is at the end of the wind and the least at the start**.
Held pull 323.56, holds false, winding 3.3346, lowering 1.1235, pressure
0.7053 which is over the limit, and the audit says error, error, warning, note.

## A deep cage winder with no balance rope

    winder Clipstone No.2
    shaft Top Hard diameter=6.7m depth=850m conveyances=2 sump=14m headgear=40m
    rope diameter=48mm construction=6x36 grade=1960 ropes=1
    drum diameter=4m width=2.2m layers=2 lead=40m
    rising cage loaded tare=11t payload=4t decks=2 width=2.4m across=1.5m
    falling cage empty tare=11t payload=0t decks=2 width=2.4m across=1.5m
    cycle full=12mps accelerate=1 decelerate=1.1 creep=0.5mps creepfor=6m rest=25s
    brake path=3.4m width=0.26m arc=55 shoes=4 friction=0.35 force=240kn

`least` is **negative**, -31.37 kN, because at the end of the wind the rope on
the falling side outweighs everything the rising side carries. So the winding
retardation has to take that off rather than add it, and a build that reaches
for an absolute value comes out 2.6329 instead of what it should.

Adding both costs about forty lines of held-out test, so the solution has to
grow by about the same to keep the patch inside the band.
