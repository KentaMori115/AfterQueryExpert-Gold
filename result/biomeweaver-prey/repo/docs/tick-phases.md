# Tick phases

Each tick applies changes in this order:

1. apply fixed events
2. renew environmental resources
3. calculate species demand
4. allocate resources
5. apply condition changes
6. apply baseline mortality
7. apply authored predation
8. apply reproduction
9. advance life stages
10. enforce non-negative invariants
11. write attributed flows

Phase 7 settles every predator and every prey cohort together rather than one
predator at a time, so no cohort is favoured by where its name sorts. See
`docs/predation.md`.

Input and output tick states are immutable. A failed phase leaves the previous
good tick intact.
