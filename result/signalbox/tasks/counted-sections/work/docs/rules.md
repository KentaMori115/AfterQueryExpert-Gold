# The rules

Every rule `signalbox check` runs, what it is about, and what to do when
it fires. This file is generated from the rules themselves by
`signalbox rules --markdown`, so it is never out of date.

| Code | Severity | Checks that |
| --- | --- | --- |
| `aspect-clamp` | warning | signals can show the aspect the sequence wants |
| `aspect-dark` | error | every running signal has a route |
| `aspect-junction` | advice | diverging routes are approach controlled |
| `berth-missing` | warning | every signal has a berth track |
| `berth-shared` | advice | two signals do not berth in the same section |
| `capacity-heads` | advice | four aspect signalling is used where it pays |
| `capacity-target` | warning | the line meets its headway target |
| `capacity-worst` | advice | no block holds the whole line up |
| `crossing-open` | warning | open crossings are not on fast line |
| `crossing-route` | advice | routes over crossings say what they prove |
| `crossing-warning` | warning | automatic crossings get their warning time |
| `detection-gap` | error | every piece of track is detected |
| `detection-joint` | advice | signals stand at a section joint |
| `detection-long` | warning | sections are short enough to release usefully |
| `detection-zone` | warning | reset zones are no wider than they need to be |
| `flank-open` | error | every flank is protected by something |
| `flank-shared` | error | flank points wanted two ways at once |
| `flank-signal` | warning | flank protection by held signal only |
| `gradient-falling` | advice | routes do not fall into their signal |
| `gradient-steep` | warning | no route is steep enough to stall a train |
| `gradient-summit` | advice | summits inside a route are worth knowing about |
| `layout-deadend` | warning | a train can get out of every siding |
| `layout-naming` | advice | signals follow the scheme prefix |
| `layout-numbering` | advice | signal numbers are odd or even by direction |
| `layout-stranded` | error | every piece of track can be reached |
| `locking-bottleneck` | advice | no route locks out most of the scheme |
| `locking-headon` | error | no two routes hold the same track head on |
| `locking-split` | error | no route asks for points two ways at once |
| `overlap-missing` | error | routes that should have an overlap have one |
| `overlap-short` | warning | overlaps reach the standard length |
| `overlap-swing` | advice | swinging overlaps are worth knowing about |
| `points-hand` | warning | hand points are not on signalled routes |
| `points-lock` | error | facing points are locked |
| `points-slow` | advice | points throw quickly enough |
| `points-unused` | advice | every set of points is used by something |
| `reversible-direction` | error | one way track is not signalled against itself |
| `reversible-unused` | advice | bidirectional track is used both ways |
| `route-duplicate` | warning | no two routes are the same route twice |
| `route-long` | advice | no route is far longer than the rest |
| `route-none` | error | every signal has somewhere to go |
| `route-shunt` | advice | shunt routes are over slow track |
| `setting-clears` | warning | every main route clears its signal |
| `setting-pairs` | error | the machine agrees with the conflict table |
| `setting-refused` | error | every route can be set on an empty railway |
| `sighting-nonsense` | error | sighting distances are numbers |
| `sighting-short` | error | signals can be seen for long enough |
| `sighting-unmeasured` | advice | every signal has a sighting distance |
| `spacing-heads` | warning | four aspect signalling is not broken by a three aspect |
| `spacing-short` | error | signals are a braking distance apart |
| `standards-braking` | warning | the braking rate is one a train could manage |
| `standards-flank` | advice | the flank search covers the layout |
| `standards-overlap` | warning | the overlap holds a train from a stand |
| `standards-reduced` | error | the reduced overlap is shorter than the standard one |
| `tpws-missing` | warning | fast signals have an overspeed grid |
| `tpws-room` | error | overspeed grids fit between the signals |

## aspect-clamp

*warning: signals can show the aspect the sequence wants*

The aspect sequence wants an aspect this signal has not got the heads to show.

**What to do:** Add a head, or accept that the driver gets a more restrictive aspect than the sequence intends.

## aspect-dark

*error: every running signal has a route*

No route reads from this signal, so it can never clear.

**What to do:** Usually the direction of working on the track it stands on is wrong, or the signal is facing the wrong way.

## aspect-junction

*advice: diverging routes are approach controlled*

A diverging route much slower than the line, with nothing to make the driver slow down for it.

**What to do:** Approach control the junction signal from red, or fit a flashing aspect sequence.

## berth-missing

*warning: every signal has a berth track*

There is nowhere for a train waiting at this signal to be seen.

**What to do:** Add a section behind the signal.

## berth-shared

*advice: two signals do not berth in the same section*

Two signals berth in the same section, so the describer cannot tell which of them a train is standing at.

**What to do:** Split the section, or accept it where the two signals are never occupied at once.

## capacity-heads

*advice: four aspect signalling is used where it pays*

Three aspect signalling on fast line, where a fourth head would buy capacity back.

**What to do:** Add the head, if the traffic justifies it.

## capacity-target

*warning: the line meets its headway target*

The line does not meet the headway it was drawn for.

**What to do:** Shorter blocks, more aspects, or a different timetable.

## capacity-worst

*advice: no block holds the whole line up*

One block is much worse than the rest, so it sets the headway of the whole line.

**What to do:** Split it, or accept the headway.

## crossing-open

*warning: open crossings are not on fast line*

An open or user worked crossing on fast line.

**What to do:** These are usually closed or upgraded rather than accepted.

## crossing-route

*advice: routes over crossings say what they prove*

The route proves a crossing before its signal will clear.

**What to do:** Nothing, this is a note of what the route does.

## crossing-warning

*warning: automatic crossings get their warning time*

An automatic crossing whose strike in point is too close to give road users their warning time.

**What to do:** Move the strike in point back, or bring the line speed down.

## detection-gap

*error: every piece of track is detected*

There is track no section covers, so the interlocking cannot see a train on it.

**What to do:** Extend a section over it or add one.

## detection-joint

*advice: signals stand at a section joint*

A signal a long way from a joint means the section behind it is not a berth, so the signal cannot be replaced behind a train promptly.

**What to do:** Move the joint to the signal.

## detection-long

*warning: sections are short enough to release usefully*

A very long section releases a long way behind the train, which costs capacity.

**What to do:** Split it, if the traffic is worth the equipment.

## detection-zone

*warning: reset zones are no wider than they need to be*

Counted sections a train runs directly between are reset together, so a wide reset zone takes the whole of it out of use at once.

**What to do:** Break the run with a track circuit, or accept that resetting any of it means proving all of it clear.

## flank-open

*error: every flank is protected by something*

Something can run into the side of this route and nothing stops it.

**What to do:** Lay a set of points away from the route, put a trap in, or hold a signal at danger. If none of those are possible the move has to be worked another way.

## flank-shared

*error: flank points wanted two ways at once*

Two routes want the same points lying opposite ways for flank protection, so one of them can never be set.

**What to do:** One of the two routes is protected the wrong way round. Work out which movement each is protecting against.

## flank-signal

*warning: flank protection by held signal only*

The only thing keeping a movement off the side of this route is a signal at danger, and a signal can be passed.

**What to do:** Where the layout allows it, call a set of points away from the route as well. Where it does not, this is usually accepted.

## gradient-falling

*advice: routes do not fall into their signal*

The route falls into its signal, so a driver braking for it is getting no help from the gradient at the point it matters most.

**What to do:** Nothing, usually. It is worth knowing when the spacing is tight.

## gradient-steep

*warning: no route is steep enough to stall a train*

The route runs over a gradient steep enough that a train stopped on it may not be able to restart.

**What to do:** Check the traffic that will use it, and whether it can be stopped there by signals.

## gradient-summit

*advice: summits inside a route are worth knowing about*

The road rises and then falls inside the route, so a stalling train ends up at the summit rather than anywhere convenient.

**What to do:** Nothing, unless the summit is somewhere a train would be held.

## layout-deadend

*warning: a train can get out of every siding*

A train can get into this siding and the direction of working will not let it out.

**What to do:** Make the siding bidirectional.

## layout-naming

*advice: signals follow the scheme prefix*

A signal that does not follow the scheme prefix will end up being called two different things in two different documents.

**What to do:** Rename it, or change the prefix.

## layout-numbering

*advice: signal numbers are odd or even by direction*

Down signals are conventionally odd and up signals even.

**What to do:** Renumber, unless the scheme has its own convention.

## layout-stranded

*error: every piece of track can be reached*

No train can reach this track from a boundary.

**What to do:** Check the direction of working, and check the ports the edges join.

## locking-bottleneck

*advice: no route locks out most of the scheme*

One route locks out most of the scheme, so setting it stops everything else.

**What to do:** Often unavoidable at a single lead junction. Worth knowing before the timetable is written.

## locking-headon

*error: no two routes hold the same track head on*

Two routes can be set over the same track in opposite directions.

**What to do:** This is a bug in the interlocking data. It has to be fixed, not accepted.

## locking-split

*error: no route asks for points two ways at once*

A route asks for the same points two ways at once, so it can never be set.

**What to do:** Its flank or overlap requirement contradicts the route itself.

## overlap-missing

*error: routes that should have an overlap have one*

There is no track beyond the exit signal to hold as an overlap.

**What to do:** Either the signal is in the wrong place or the route should end somewhere else.

## overlap-short

*warning: overlaps reach the standard length*

The overlap is shorter than the scheme's standard, so a train that overruns has less room than the design assumes.

**What to do:** Move the signal, reduce the approach speed, or accept the short overlap and record why.

## overlap-swing

*advice: swinging overlaps are worth knowing about*

The overlap can be held two ways, which is normal at a junction and worth knowing about because it changes what else can be set.

**What to do:** Nothing, unless the swinging was not intended.

## points-hand

*warning: hand points are not on signalled routes*

Routes are signalled over points the interlocking cannot move.

**What to do:** Either the points get a machine or the moves over them stop being signalled.

## points-lock

*error: facing points are locked*

Facing points with no lock on the blades under a passenger move.

**What to do:** Fit a facing point lock. There is no other answer.

## points-slow

*advice: points throw quickly enough*

Slow points hold up every route that calls them.

**What to do:** A faster machine, or accept the setting time.

## points-unused

*advice: every set of points is used by something*

Nothing runs over these points, holds them, or calls them for flank.

**What to do:** Usually a leftover from an earlier stage of the drawing.

## reversible-direction

*error: one way track is not signalled against itself*

A signal on one way track reading against the way the track is worked, which means it can never be cleared.

**What to do:** Turn the signal round or change the direction on the edge.

## reversible-unused

*advice: bidirectional track is used both ways*

Track marked as worked both ways that only has moves signalled over it one way, which is expensive equipment doing nothing.

**What to do:** Either signal the moves the other way or mark the track one way.

## route-duplicate

*warning: no two routes are the same route twice*

The same move is signalled twice under two names.

**What to do:** One of the two is redundant.

## route-long

*advice: no route is far longer than the rest*

A route much longer than its neighbours, which is usually a signal that has not been drawn yet.

**What to do:** Add a signal, or accept the longer block and its headway.

## route-none

*error: every signal has somewhere to go*

This signal has no route, so it can never do anything but stop trains.

**What to do:** Check what is in front of it and which way it faces.

## route-shunt

*advice: shunt routes are over slow track*

A shunt move over track faster than shunting speed.

**What to do:** Usually the speed on the plan is the running speed and the shunt move has its own lower limit.

## setting-clears

*warning: every main route clears its signal*

The route sets but the signal stays at danger with a clear road.

**What to do:** Check the points the route calls and the track it holds.

## setting-pairs

*error: the machine agrees with the conflict table*

The control table says two routes are compatible and the machine refuses to set them together.

**What to do:** One of the two is wrong. Fix the disagreement before anything else.

## setting-refused

*error: every route can be set on an empty railway*

The interlocking will not set this route with nothing in the way.

**What to do:** The reason is printed with the finding, and it is always something the data says rather than something the layout does.

## sighting-nonsense

*error: sighting distances are numbers*

The sighting distance in the plan is not a number.

**What to do:** Correct the plan.

## sighting-short

*error: signals can be seen for long enough*

The signal cannot be seen for long enough to be read and acted on.

**What to do:** Move it, clear the sighting, fit a banner repeater, or bring the approach speed down.

## sighting-unmeasured

*advice: every signal has a sighting distance*

Nobody has recorded how far this signal can be seen from.

**What to do:** Measure it on site and put the figure in the plan.

## spacing-heads

*warning: four aspect signalling is not broken by a three aspect*

A three aspect signal behind a four aspect one loses a block of warning without anybody noticing.

**What to do:** Give the signal in rear the extra head, or accept the shorter warning and check the braking distance holds.

## spacing-short

*error: signals are a braking distance apart*

A driver braking from line speed cannot stop at the signal ahead.

**What to do:** Move a signal, add one in between, or bring the line speed down.

## standards-braking

*warning: the braking rate is one a train could manage*

The braking rate in the plan is not one a train could manage.

**What to do:** Correct the figure. Every spacing check depends on it.

## standards-flank

*advice: the flank search covers the layout*

The flank search is shorter than the layout, so protection that is there will be reported as missing.

**What to do:** Raise the figure until it covers the longest edge.

## standards-overlap

*warning: the overlap holds a train from a stand*

The standard overlap is shorter than the distance a train takes to stop from the speed it may pass the signal at.

**What to do:** Lengthen it, or record why the approach is slower than assumed.

## standards-reduced

*error: the reduced overlap is shorter than the standard one*

The reduced overlap is longer than the standard one, so the two figures are the wrong way round.

**What to do:** Swap the two figures over.

## tpws-missing

*warning: fast signals have an overspeed grid*

A main signal with no overspeed grid, so a train can arrive too fast to stop at it.

**What to do:** Fit one, or record why the approach speed makes it unnecessary.

## tpws-room

*error: overspeed grids fit between the signals*

The overspeed grid would have to go further back than the signal in rear, where it would catch trains that are not going anywhere near the signal it protects.

**What to do:** Raise the set speed, or accept a grid nearer the signal and record the shortfall.
