# sheave

Colliery winding arithmetic: the rope that has to lift itself before it
lifts anything, the drum it coils on, the cycle it works to, and the
depth at which all three run out.

Named for the wheel at the top of the headgear, which is the only part
of a winding installation anybody outside a colliery has ever seen and
the one part of it that does no work at all.

A winding rope's breaking length — the length at which it will just
carry its own weight — does not depend on its diameter, because doubling
the diameter quadruples both the strength and the weight. So a bigger
rope does not reach deeper on its own account. It reaches deeper only
because it can carry a bigger conveyance, and at some depth it cannot
carry any conveyance whatever. Most of this library is that fact working
its way through a colliery.

No runtime dependencies. TypeScript, and a command line over the top of
it.

```
npm install
npm run check
npx tsx src/cli/main.ts winder examples/bolsover.winder --year
```

## What it does

```
$ sheave conveyance --kind skip --payload 12t --compare

the skip: a skip of 5.04 t tare carrying 12.00 t, 70.4% useful
...
the same payload both ways
--------------------------
                     cage      skip
---------------  --------  --------
tare              24.00 t    5.04 t
gross             36.00 t   17.04 t
useful fraction     33.3%     70.4%
it hangs         353.0 kN  167.1 kN
men it carries         39      none
```

and, given a certificate in a plain text file:

```
$ sheave audit examples/wheal-jane.winder --errors

severity  part
--------  -----  ----------------------------------------------------------------
 error    drum   A 2.1 m drum on a 32 mm rope is 65.63 to one where 80 is the
                 least: the rope wants 2.56 m and will fail from the inside on
                 this one
 error    drum   A fleet angle of 3.021° is past 1.5°: the rope rides up on the
                 turn beside it and drops, and the cure is a lead of 36.3 m
                 rather than 18
 error    shaft  2 conveyances 1.9 m wide will not go down a 4.9 m shaft: the
                 widest it takes is 1.77 m
 error    shaft  A 4 m sump will not stop an underwind at 9 m/s, which wants
                 4.2 m
```

## The commands

| command      | what it does                                                    |
| ------------ | --------------------------------------------------------------- |
| `rope`       | what a rope stands, what it weighs, and where the second beats the first |
| `wear`       | when a rope comes off, and the rule whose factor falls with depth |
| `capel`      | the termination, and the calendar it puts on a sound rope        |
| `shaft`      | what will and will not go down the hole                          |
| `guides`     | what keeps a conveyance from swinging                            |
| `drum`       | the fleet angle, and the second layer that is worse in every way  |
| `koepe`      | the friction winder, and the ratio it has to live inside          |
| `conveyance` | the cage against the skip, which is an argument about tare        |
| `cycle`      | the wind, and the standing time that beats it                     |
| `power`      | what the engine does, and the r.m.s. that is not the peak          |
| `safety`     | the gear that does not trust the engineman                        |
| `winder`     | a whole installation, read from a file                            |
| `size`       | an installation for a duty, in one direction                      |
| `checks`     | the figures an installation is signed off against                 |
| `audit`      | what a winding engineer would say after a week here               |
| `cost`       | what winding costs, and the day down that costs more              |
| `works`      | the chain the winder is only one link of                          |

Every quantity carries its unit — `--diameter 52mm`, `--depth 942m`,
`--full 15mps`, `--payload 12t`, `--hanging 100tonf` — and a quantity
without one is refused, as is an option no command takes. A length may
be written in fathoms, a speed in feet a minute and a power in
horsepower, because the trade still speaks in all three.

## The library

```ts
import { rope, cycle } from "sheave";

const line = rope.rope(52);

rope.breakingLoad(line);         // 1861 kN
rope.massPerMetre(line);         // 9.94 kg/m
rope.breakingLength(line);       // 19,091 m — the same for any diameter
rope.factorFor(942);             // 5.93, because the rule falls with depth
rope.mostHanging(line, 942);     // 222 kN, once the rope's own weight is off
```

and the brake, which is a machine and not an assumption:

```ts
import { safety, winder } from "sheave";

const machine = winder.parseWinder(sheet);
safety.torque(safety.brakeOf(machine));  // 756 kNm off the shoes
safety.heldPull(machine);                // 360 kN at the rope
safety.retardationWinding(machine);      // 4.11 m/s² stopping a wind
safety.retardationLowering(machine);     // 2.09 m/s², the smaller figure
```

The namespaces follow the order the load travels: `units`, `rope`,
`shaft`, `drum`, `cage`, `cycle`, `power`, `safety`, `winder`, `design`,
`costing`, `works`, `report`, `cli`.

## Four things it is opinionated about

**The rope is most of the load at depth.** Every function that asks
whether a rope is strong enough counts the rope's own weight inside the
factor of safety, because the regulation does. At nine hundred metres a
forty millimetre rope is a quarter of what it is lifting; at eighteen
hundred it is nearly half; and the depth at which it is all of it is
several kilometres shallower than the breaking length suggests.

**The span of a taut string's stiffness is the conveyance and not the
shaft.** A rope guide is a spring whose stiffness is four times its
tension over the span between whatever is holding it — and that span is
the conveyance's own shoes, a few metres apart. Put the shaft depth in
instead and the sway comes out two hundred times too soft, which is
several metres and would be visible from the surface.

**Sizing is a cascade and not a loop.** The cycle decides the payload,
the payload the conveyance, the conveyance and the depth the rope, the
rope the drum, the conveyance the shaft. Every arrow points forward. The
feedback everybody expects — a bigger rope weighing more and therefore
wanting a bigger rope — is real, and it lives one level down inside the
search for a diameter, which walks up the sizes with the rope's own
weight counted at every step.

**The winder is rarely the shortest link.** `sheave works` puts the
winder on one sheet with the faces, the pit bottom, the screens and the
loader, and compares them on the day rather than the hour — because a
link that works round the clock at half the rate passes more than one
that works a single shift at twice it, and the winder is nearly always
the link that works the fewest hours.

## Documentation

- [The winder file](docs/winder-file.md) — the format, its keywords, its
  units, and what it refuses. Three worked examples come with it: a deep
  drum winder on skips, a four-rope friction winder, and a small cage
  winder with four things wrong with it.
- [Where the numbers come from](docs/where-the-numbers-come-from.md) —
  which constants are physical facts, which are regulation, which are
  fitted, and which are simply practice.

## What is not modelled

Rope dynamics of any kind — the longitudinal bounce that makes a deep
winder's rope a spring with a period of its own, and the torsional
unwinding that makes a single rope spin a conveyance. Shaft sinking.
Ventilation beyond the free area. And anything about what happens when a
wind goes wrong past the point where the safety gear acts.

## Licence

MIT.
