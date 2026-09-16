Backup page exports a campaign and reads a bundle back only to count it. Nothing writes one in.

Add `restoreBundle(bundle, store)` in `src/core/io/restore.ts`. Hand it a parsed bundle and a `KeyValueStore`; it writes that campaign in fresh, returning `{ campaignId, restored, skipped }`, both tallies counting per module: characters, factions, locations, sessions, arcs, encounters, relationships, lore, items, quests, timeline, notes, tags, holidays, downtime.

Every row gets a fresh id; a bundle restored twice lands twice, stored rows untouched. References follow, rewritten to the new id of the row they name, whichever way they point: a parent listed after its child, a faction and leader naming each other. A parent that would close a loop is dropped, rows taken in bundle order.

Where a reference points at something left behind, nullable fields empty, list entries drop: attendees, tag marks. An initiative row stays, character cleared. Rows needing one are skipped: relationship ends, note subjects, downtime characters. An item whose owner stayed behind returns unowned and unattuned, and nobody holds more than three attuned: earliest three by created stamp keep theirs, ties by bundle order, the rest unattuned.

Rows keep the created stamp they arrived with, taking a fresh updated one. Campaign keeps its start, last played and created stamps; session count becomes sessions written. Sessions keep their ordinal; one without a whole number above zero is skipped.

Skip and count a row its model rejects, one carrying another campaign's id, one reusing a restored tag name, a repeated id, first winning. Per module, restored plus skipped is rows handed over; a module a version 1 bundle omits counts zero. If the campaign row fails validation, write nothing, report no campaign, count nothing.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
