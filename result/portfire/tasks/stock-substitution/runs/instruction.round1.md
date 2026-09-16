Shows get designed against the house catalog and fired against whatever the magazine holds, and portfire only notices in `inventory`. `src/catalog/substitute.ts` knows what could stand in, nothing calls it. Make the compile fire from stock.

`compile` takes a `magazine` (a `Magazine`) and `pull`, lot numbers quarantined before anything is drawn, without touching the book you passed. Every show command gets `--magazine book.csv` and `--pull vn2405,vn2413`.

Drawing runs in firing order, visible time then script order. Each shot draws one of its own effect while stock lasts, so later cues go without. Only after every cue has drawn its own are the shots left without covered, same order, from what is left. Candidates are what `substitutesFor` offers by default, exact calibre before band match, then nearest lead, then id. A unit lent is gone for the next shot, so one shortfall may be covered by several stand-ins. A shot nothing covers keeps its own effect and the show is not ready.

Within one effect, draw from the lot received earliest. Undated lots come after every dated one, ties go by lot number.

A covered shot keeps its cue time and fires on the stand-in's lead, height clause included. Its event carries the stand-in as `effectId` and `effect`, what the script asked for as `substitutedFor`, the lot drawn as `lot`. A shot that drew its own effect carries `lot` alone. Pin allocation and the safety checks see the stand-in.

Report one PF1601 note per asked-for and stand-in pair when calibre matches, PF1602 warning when only band does, each saying how many, plus one PF1600 error per effect left short. Cue sheet gains a `lot` column once a magazine was given.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
