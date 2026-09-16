# Disturbances

A scenario hook opens an authored event on one tick. Each effect on that event
runs from the hook's tick for `forTicks` ticks, one by default. Hooks are read
in tick order and then by event id, and an event's own effects in the order the
file lists them.

An effect carries either a `resource` with a `quantity` or a `modifier` with a
`factor`. A `region` narrows it to one place; without one it reaches the whole
biome.

## Quantity effects

The quantity is divided across the pools the effect reaches, in proportion to
what each pool holds when the effect runs. Division floors, and the units left
over walk those pools in region id order, one each. Pools that hold nothing
between them share the quantity evenly instead.

A withdrawal never takes more than a pool holds, and the part it could not take
is not passed to another pool.

Each pool that moved publishes its own flow, carrying that pool's region and
the quantity that pool really gave up or took on, cause `fixed-event` and rule
`events.<event id>`.

## Modifier effects

A modifier effect scales the habitat modifier its key names for as long as its
window runs. Two windows over one key and region multiply, in the order their
events fire, rounding half-even at each step. Renewal reads the scaled factor;
the effect publishes no flow of its own, because the renewal flow already
carries the difference it made.
