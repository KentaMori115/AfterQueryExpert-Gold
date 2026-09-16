CloudVault buffers each upload whole and ships it in one request, so a drop at 200MB
starts over. Add session tracking for resuming clients.
Timestamps are `Date.now()` milliseconds.

`lib/upload-session.ts`: `createUploadSession(id, userId, filename, totalSize, startedAt)`
trims the name, refusing a blank one or a size outside one whole byte to the 250MB ceiling
in `lib/file-utils.ts`. `recordChunk(session, start, end, at)` takes an arrived range,
ends inclusive, any order; overlapping, touching and repeat ranges merge, a byte sent
twice is held once, every accepted call stamps `at`. Ranges outside the file, ending before
they start, or on fractional offsets throw and change nothing. `uploadStatus(session)`
answers `receivedBytes`, `nextOffset` (first missing byte, zero while byte zero is),
`missing` (holes in order, tail included) and `complete`.

`lib/upload-parts.ts`: `partsFor(totalSize)` cuts the file onto a 45MB grid as `{index,
start, end}`, back to back, last short. `nextUploadBatch(session)` hands over parts held
whole, lowest first, as `{index, name, start, end, size}`, marking them off so none goes
twice. Names follow the `.partN_of_M` convention in `app/api/upload/route.ts` against the
file's part count; one part files keep their own name.

`lib/upload-store.ts`: `createSessionStore()`, `openSession(store, session, now)`,
`getSession(store, userId, id, now)` and `sweepSessions(store, now)`. A session is idle
six quiet hours after its last chunk, that instant included. Readers skip idle sessions
and other accounts; swept ids come back sorted as text. Four live per account; idle ones
free a place, an open id is refused.

`lib/upload-assembly.ts`: `assembleUpload(session, uploaded)` builds the metadata record
the upload route writes today from one `{index, fileId, filePath}` per part. First part's
identifiers stand for the file, `chunks` and `chunkPaths` carry all parts in order, one
part carries neither. Unfinished sessions and missing, repeated or unknown parts are
refused.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
