# The air, and what it costs

A winding shaft is also the colliery's downcast at nearly every pit
that ever worked, so the two duties are competing for the same square
metres. The shaft module says how many the conveyances leave. This is
what the fan pays for the ones that are left.

## Resistance

An airway is a length, a section, a rubbing perimeter and a friction,
and its resistance is all four put together as kCL/A³. Everything about
that expression is linear except the section, which is cubed: once for
the air that has to get through and twice for the speed it has to do it
at. A tenth off the section of a shaft is a third onto the fan's bill,
and that exponent is the whole argument between the winding engineer
and the ventilation engineer, who are usually the same person and who
usually settles it in favour of the winding.

The rubbing surface is the lining, the whole way round, and not the way
round what is left after the conveyances are in it. Air rubs on the
wall whatever is hanging in the middle of the shaft.

## The fan

A fan has no duty of its own. It has a characteristic, which this
library takes as a parabola between two figures off the maker's sheet:
the pressure it makes against a shut door, and the quantity it passes
against nothing at all. The colliery has a resistance. What goes down
the pit is where the two cross, and it is neither of the numbers the
maker printed.

The other fan is the one nobody bought. Warm air up the upcast against
cold air down the downcast is a column of one against a column of the
other, and the difference works whether the fan is running or not. It
is worth a few hundred pascals in a deep pit: a tenth of what the fan
does, and the whole of what is left when the fan has stopped. In a hot
summer it can turn round, which is a subject with its own literature
and several inquests in it.

## What the pit is asking for

Three demands, and the fan is sized for the largest of them: the men,
at a tenth of a cubic metre a second each; the coal, at a twentieth for
every tonne wound in a day; and the gas, at whatever holds the make
below the share the law allows. Which one decides it changes as a pit
ages, and a colliery arguing about its fan is usually a colliery that
has not noticed the answer has changed.

## Splitting

Air takes the easy road. Roads side by side carry one pressure and
divide the quantity as one over the root of each resistance, so the
short level beside the shaft takes far more than its share and the far
face takes almost none. What is left of a ventilation plan after the
arithmetic is doors: a regulator is the cheapest thing on the plan and
the most wasteful, being pressure the fan made and the colliery threw
away.

## What it refuses

Every refusal here carries the name of the argument that was wrong, the
way the rest of the library does. A section of nought is refused as a
section and not as a resistance, a fan without a name is refused as a
name, and a gas limit written as a percentage rather than as a share is
refused as a limit. On a sheet with a shaft, a fan, three demands and a
set of workings on it, "that is not a number" is not a message anybody
can act on.

The one place this is worth more than tidiness is the friction. A
friction of nought passes silently through every formula here and comes
out as a colliery of no resistance at all, ventilated by any fan with
room to spare, which is the sort of answer a person acts on before they
notice it cannot be true.

## Working one out

```
sheave ventilation --diameter 7.3m --depth 942m --width 2.2m
sheave ventilation --gas 3 --men 1200
sheave ventilation --shutoff 6000 --delivery 500 --workings 0.05
sheave ventilation --width 2.8m --split
```

The first says what a shaft of that size settles at behind ordinary
workings, the second what a gassy pit is asking for and which of the
three is doing the asking, the third what a larger fan buys, and the
fourth how little of it reaches the far face.
