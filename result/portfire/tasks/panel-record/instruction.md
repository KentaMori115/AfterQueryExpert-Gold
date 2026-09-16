Panel writes it down, nobody reads it back.

Log:

    pin,fired
    01.01,0.000

`rehearse --log <csv>` grades a dry run. Pin columns follow continuity walk, missing one too; time column reads time, fired, at or fired at, cue time form. Log times are ignition times plus compiled pre roll. parsePanelLog(text, source) returns rows of address, at and line beside diagnostics; unreadable rows error, skipped. gradeLog(schedule, rows, options) matches each show pin to its earliest logged time, others extra. Out come fired in table order, missed as events, extra as rows, late and early, all lists, empty not absent, and worst, gone when nothing slipped. Each match keeps event, row and offset, late positive. Past options.tolerance, one frame of show's format unless --tolerance <ms> says, match is late or early. checkLog calls missed and extra errors, late and early warnings. Grade prints to standard output or --out, diagnostics to standard error, errors nonzero.

Morning after. `continuity --after <csv>` reads the walk sheet, --walk turning optional. reconcileAfter(expected, before, after) splits show pins, each list by pin. Still connected is misfired. Connected after, open before, is dead, given a before walk. Never reported after is unknown, short is shorted, rest fired. Pin outside show, connected before, open after, is burnt. unfiredPins is everything but fired, by pin. checkAfterWalk raises dead and burnt as errors, unknown as warning. clearancePlan(schedule, misfires) lists positions soonest first, each naming position, misfires, wait and clearAt, show's last light out plus that position's longest wait, and fieldClearAt, zero when nothing misfired. planRefires takes options.usable, pins a lead may go on, so refires use only what the walk read open. Anything unfired or burnt exits nonzero. Everything new exports from the package root.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
