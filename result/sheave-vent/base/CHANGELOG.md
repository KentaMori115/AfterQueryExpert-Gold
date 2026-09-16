# Changelog

## 0.1.0

The first of it: the rope, the machine that drives it, and the colliery
that pays for both.

- `errors` — one error class, and every refusal carrying the name of the
  quantity that was wrong.
- `units` — rounding half away from zero without ever giving back a
  negative nought, and the units a colliery never quite settled on. A
  weight refuses a negative mass and an out-of-balance does not, which
  is not pedantry: a negative weight is a mistake and a negative
  out-of-balance is Tuesday.
- `rope` — construction, breaking load, the breaking length that does
  not depend on the diameter, the rule whose factor of safety falls with
  depth, bending fatigue, and the capel that puts a calendar on a sound
  rope.
- `shaft` — what will and will not go down the hole, the free area the
  fan is left with, the overwind room, and the guides. The span of a
  rope guide's stiffness is the conveyance's shoes and not the shaft,
  which is the error this module exists to have got right.
- `drum` — the cylindrical drum, the fleet angle and the second layer
  that is worse in every way; and the friction winder, whose ratio is
  made worse by depth and not better, which is the opposite of what one
  expects.
- `cage` — the cage against the skip, which is an argument about tare and
  nothing else.
- `cycle` — the wind, and the shallow shaft in which a faster winder buys
  nothing at all.
- `power` — the out-of-balance that swings the whole weight of the rope
  twice over, the r.m.s. that is not the peak, and the balance rope that
  answers both.
- `safety` — the overspeed curve, and the detaching hook, which is the
  one part of a winding installation designed to break.
- `winder` — a whole installation, the file that describes one, and the
  audit that can tell a good one from a bad one.
- `design` — sizing as a cascade rather than a loop, and the figures an
  installation is signed off against, ranked by how much room each has.
- `costing` — what winding costs, and the day down that costs more than
  a year of it.
- `works` — the chain the winder is only one link of, compared on the day
  and not the hour.
- `report`, `cli` — seventeen commands, none of which prints from inside
  the library.
