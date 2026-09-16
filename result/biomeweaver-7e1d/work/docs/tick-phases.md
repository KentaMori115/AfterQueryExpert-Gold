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
10. enforce seat and non-negative invariants
11. write attributed flows

Step 10 also holds a region to the seats its habitats offer. Occupancy is the
headcount of one species in one region, each cohort weighted by the space its
stage takes. Where occupancy passes the seats, the surplus is taken off the
cohorts in proportion to the room they fill, leftovers going by cohort key
order, and every cohort that keeps a seat has its condition divided by the
pressure the region was under. Species no habitat seats are unlimited.

Worked through, for a region seated at 100 holding 90 adults at one seat each
and 40 juveniles at half a seat:

```text
occupancy 90 + 20 = 110
pressure  110 / 100 = 1.100000
surplus   10, shared 90:20 by room filled
adults    10 x 90/110 = 8.181818, plus the leftover unit -> 8.181819
juveniles 10 x 20/110 = 1.818181, over half a seat each -> 3.636362 taken
left      81.818181 adults and 36.363638 juveniles, filling 100 exactly
condition 1.000000 / 1.100000 = 0.909091 for both
```

Input and output tick states are immutable. A failed phase leaves the previous
good tick intact.
