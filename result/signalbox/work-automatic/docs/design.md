# How signalbox is put together

The package is a stack. Each layer knows about the one below it and nothing
about the one above, and the only I/O is at the two ends.

```
cli          one module per command, no logic of its own
  |
verify       rules, findings, waivers, guidance
tables       control, points, aspect and locking tables, rendered and diffed
interchange  the file that gets handed over, its schema and its comparison
render       schematics, panels and train graphs
sim          the interlocking working: machine, trains, drivers, scenarios
  |
signalling   routes, overlaps, flanks, locking, aspects, braking, headway
topology     the track graph, positions, walking, sections, chainage
layout       the scheme plan language: tokens, parser, validation, formatter
units        distances, speeds and gradients
```

## What each layer owns

`layout` turns text into declarations and checks that the declarations describe
something buildable. It is the only place that reads a file for input, and the
only place that knows what a scheme plan looks like.

`topology` turns declarations into a graph and answers questions about it. It
has one way of walking, in `topology.traverse`, and everything that walks the
graph uses it. Nothing here knows what a signal is.

`signalling` is where the interlocking is worked out. Routes are found by
walking forward from each signal, overlaps beyond each exit signal, flanks by
walking back from the ends a route does not use, and locking from the sub routes
each route holds. Everything in here is a pure calculation over a `Scheme`.

Automatic signals are worked out in `signalling.automatic`, above routes and
below everything that acts on them: it says which of the signals the plan
declares automatic can really be left to the trains, and what stops the rest.
The machine sets those routes and keeps them set, the rules report the rest, and
neither of them decides the question twice.

`sim` runs the result. The machine holds the state and applies the same rules
the tables were generated from; `sim.lamps` works out what each signal shows;
trains and drivers move over the graph; scenarios script the lot.

`verify`, `tables`, `render` and `interchange` are all readers. They take what
`signalling` decided and turn it into findings, documents, drawings and a file.
None of them decides anything about the railway.

`cli` is a thin wrapper. If a command needs more than a dozen lines of its own,
the thing it is doing belongs in the library where it can be tested without a
terminal.

## Rules of the road

- Nothing below `cli` prints. Errors are raised, and the command line decides
  how to show them.
- Nothing below `layout.loader` reads a file.
- Everything that can be worked out twice gives the same answer twice: sorted
  output, no dependence on dictionary order, no clock in the calculation.
- A finding is a `(rule, subject)` pair. That pair is what a waiver matches and
  what a comparison between two runs is made on, so it has to be stable.
- Every design figure a rule uses comes from the scheme's own `standards` block,
  not from a constant in the rule.

## Testing

`tests/` mirrors the package. On top of the unit tests there are:

- `tests/property/` for things that must hold for every plan, such as the
  formatter being idempotent and the tables coming out the same twice.
- `tests/test_golden.py` for the exact output of the whole toolkit, recorded so
  that a change shows up as a diff rather than as a surprise.
- `tests/test_examples.py` and `tests/test_example_scenarios.py`, which run
  everything against the shipped examples.
- `tests/test_docs.py` and `tests/test_readme.py`, so the documentation cannot
  describe a package that is not here.
