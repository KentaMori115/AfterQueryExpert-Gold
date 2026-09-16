# Where the numbers come from

Every constant in this library is either a physical fact, a fitted
correlation, or a figure from practice. This is which is which, because
a reader who cannot tell them apart cannot tell which of them are worth
arguing with.

## Facts

These cannot be argued with and are not fitted to anything.

| quantity                          | value              | where it comes from      |
| --------------------------------- | ------------------ | ------------------------ |
| standard gravity                  | 9.80665 m/s²       | the definition           |
| the density of steel              | 7850 kg/m³         | measurement              |
| the modulus of steel              | 200 GN/m²          | measurement              |
| a long ton                        | 1016.047 kg        | the definition           |
| a hundredweight                   | a twentieth of one | the definition           |
| a fathom                          | 1.8288 m           | the definition           |
| a horsepower                      | 0.7457 kW          | the definition           |
| the capstan equation              | e^(µθ)             | statics                  |
| a taut string's stiffness         | 4T/L               | statics                  |
| a pendulum's period               | 2π√(L/g)           | dynamics                 |
| a beam's deflection               | FL³/48EI           | statics                  |

## Regulation

Not facts about ropes but facts about the law, which for this subject
amounts to the same thing.

| quantity                              | value                    |
| ------------------------------------- | ------------------------ |
| factor of safety at the surface       | 8                        |
| how fast it falls with depth          | 0.0022 a metre           |
| but never below                       | 4.5                      |
| broken wires in a lay that condemn    | 5 % of them              |
| diameter lost that condemns           | 7 %                      |
| examination of the rope               | daily                    |
| recapping                             | every 6 months           |
| men wound at, at most                 | 12 m/s                   |
| and accelerated at                    | 0.8 m/s²                 |
| floor a man is allowed                | 0.2 m²                   |
| firedamp in the general body, at most | 1.25 %                   |
| air a man underground is allowed      | 0.1 m³/s                 |

The shape of the first three is the important part. A rule with a single
number in it would either be too slack for a shallow shaft or would make
a deep one impossible, and the people who wrote it knew which of those
was the greater danger.

## Fitted correlations

These are regressions and rules of thumb, and every one of them names
what it was fitted to in its own docstring. They are the ones to argue
with.

| quantity                    | form                                    | fitted to                                     |
| --------------------------- | --------------------------------------- | --------------------------------------------- |
| rope breaking load          | area × grade × spinning loss            | a 40 mm 6x36 at 1960 standing 1100 kN         |
| rope mass a metre           | area × density × lay allowance          | the same rope at 5.9 kg/m                     |
| outer wire diameter         | from the area shared among the wires    | 2 mm on a 40 mm 6x36                          |
| rope life                   | a 3.5 power of the drum ratio           | 400,000 winds at 80:1, bent twice a wind      |
| skip tare                   | 0.42 of the payload                     | practice                                      |
| cage tare                   | 2.0 times the payload                   | practice                                      |
| drum crushing               | each layer adding two thirds            | practice                                      |
| checkerwork of a stove      | —                                       | not modelled here                             |
| out-of-square lateral load  | 2 % of the conveyance's weight          | practice                                      |
| conveyance shoe span        | 5 m                                     | practice                                      |
| shaft friction, lined       | kCL/A³ with k of 0.004                  | a smooth concrete shaft                       |
| air a tonne of the day wants| 0.05 m³/s                               | practice                                      |
| a fan's characteristic      | a parabola between its two ends         | a maker's sheet for a centrifugal fan         |

## Practice

Figures from how installations are actually built and worked, which vary
from colliery to colliery and which every function here lets a caller
override.

| quantity                            | value                    |
| ----------------------------------- | ------------------------ |
| least drum-to-rope ratio            | 80 (100 for locked coil) |
| most fleet angle                    | 1.5°                     |
| coiling pitch                       | 1.05 rope diameters      |
| dead turns left on the drum         | 3                        |
| friction of a stove-lined wheel     | 0.25                     |
| slip margin on a friction winder    | 1.25                     |
| lining pressure, at most            | 2 N/mm²                  |
| rope-share error on a multi-rope    | 10 %                     |
| between two passing conveyances     | 0.15 m                   |
| conveyance to lining                | 0.30 m                   |
| conveyance to its own guides        | 0.05 m                   |
| air brisk above                     | 12 m/s                   |
| fan efficiency                      | 0.7                      |
| workings behind a shaft             | the caller's own figure  |
| arrestor gear retardation           | 9.81 m/s²                |
| emergency brake                     | 2.5 m/s²                 |
| working brake                       | 1.1 m/s²                 |
| brake delay                         | 0.5 s                    |
| overspeed margin                    | 10 %                     |
| detaching hook, of the breaking load| 40 %                     |
| a tub of coal                       | 750 kg                   |
| a wagon                             | 21 t                     |

## Prices

None. Every price in `costing` is the caller's, because nothing about a
price is a fact and a library that pretended otherwise would be wrong
within the year. The defaults are an ordinary set and are there so that
the shape of the sheet can be seen, not so that anybody can quote them.

## What is not modelled

Rope dynamics of any kind — the longitudinal bounce that makes a deep
winder's rope a spring with a period of its own, and the torsional
unwinding that makes a single rope spin a conveyance. Shaft sinking.
Ventilation beyond the free area. The electrical side of the winder past
its rating. And anything at all about what happens when a wind goes
wrong past the point where the safety gear acts, which is a subject with
its own literature and no arithmetic in it worth the name.
