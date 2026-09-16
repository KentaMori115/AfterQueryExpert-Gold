sheave stops at the free area a shaft leaves the air, and `shaft.buntonDrag` hands back a
share of a resistance nothing works out. Fill that in as namespace `air` under
`src/air/`, on the root barrel, with a `ventilation` command.

`airway(name, length, area, perimeter, friction = FRICTION)` keeps all five as fields,
`FRICTION` 0.004 lined, and has `resistance` of kCL/A³. `pressureFor(resistance, quantity)` is RQ² and
`airPower(pressure, quantity)` is pQ in kilowatts. `inSeries` adds, `inParallel` gives (Σ1/√R)⁻².
`shaftAirway(shaft, width, depthOf, pipes, friction)` takes depth for length, free area for
section, and the lining the whole way round for perimeter.

`fan(name, shutoff, delivery, efficiency)` keeps its four, and its `characteristic(fan, quantity)`
is p₀(1−(Q/Q₀)²) between those ends, nothing past. `operatingPoint(fan, resistance, natural = 0)`
gives `quantity` and `pressure` where that curve crosses RQ², counting
`naturalPressure(depth, downcast, upcast)`, density difference by g by depth, on fan's side
or, negative, against it. A beaten fan passes nothing, and `fanPower(fan, resistance)` is air
power over efficiency.

`wanted(men, tonnes, gas, limit)` is the largest of 0.1 m³/s a man, whole men, 0.05 a tonne
a day, and gas over its limit share, 0.0125 unless given; `decidedBy`, same arguments, answers men,
coal or gas. `splitBetween(quantity, resistances)` gives every road one pressure,
`regulatorFor(pressure, wanted, branch)` adds p/Q² less that road, negative where that road
is already tighter, and
`deepestVentilated(fan, section, perimeter, wanted, workings, friction)` gives whole metres,
capped at the deepest shaft this library takes.

`ventilation` takes `--diameter`, `--depth`, `--width`, `--across`, `--men`, `--tonnes`,
`--gas`, with `--shutoff` 3500, `--delivery` 400, `--workings` 0.03, and reports
where that fan settles with no natural pressure counted, and which of the three asks.

Refuse as elsewhere, `WindingError` naming the argument that was wrong.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
