# Species and resources

A species record names stages, resource needs, reproduction, mortality, stage
transitions, and optional authored predation. Resource records are renewable or
consumable. Habitat records attach capacity and seasonal growth modifiers to a
region.

A species that hunts may also cap what one predator takes in a tick with
`maxIntakePerTick`, counted in prey individuals across every rule it authors.
Leave the field out and nothing caps the take. A single rule may carry
`saturation` as well, the prey count at which that rule asks for half of what
plentiful prey would give it. See `docs/predation.md`.
