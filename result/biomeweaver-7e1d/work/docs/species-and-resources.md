# Species and resources

A species record names stages, resource needs, reproduction, mortality, stage
transitions, and optional authored predation. Resource records are renewable or
consumable. Habitat records attach capacity and seasonal growth modifiers to a
region.

A species record may also give `space` per stage, the room one individual of
that stage takes against a habitat seat. Stages with no entry take one seat
each, and a stage given zero takes no room at all. A habitat `capacity` block
seats a named species; seats from every habitat on a region add up, and a
season modifier named `<species>-capacity` scales the habitat's own seats for
that season.
