// Resumable upload sessions.
//
// A client that loses its connection halfway through a 200MB upload should not
// have to start again. A session records which byte ranges of the file have
// actually arrived, in whatever order they arrive, and answers the two
// questions a resuming client asks: how much is here, and where do I carry on
// from.

import { MAX_FILE_SIZE } from "./file-utils"

// Telegram refuses a document above 50MB, so the upload route cuts anything
// larger into 45MB pieces. A session is measured against the same grid.
export const MAX_PART_SIZE = 45 * 1024 * 1024

// A session that has taken no traffic for six hours is abandoned.
export const SESSION_IDLE_MS = 6 * 60 * 60 * 1000

// A closed interval of file offsets: both ends are byte positions that belong
// to the range, the same numbers a Content-Range header carries. Half open
// bounds would be easier to add up, but every client sending these is reading
// them off an HTTP header, and translating at the door is one fewer place for
// an off by one to live.
export interface ByteRange {
    start: number
    end: number
}

export interface UploadSession {
    id: string
    userId: string
    filename: string
    totalSize: number
    startedAt: number
    updatedAt: number
    received: ByteRange[]
    flushedParts: number[]
}

export interface UploadStatus {
    receivedBytes: number
    nextOffset: number
    missing: ByteRange[]
    complete: boolean
}

function isWholeNumber(value: number): boolean {
    return Number.isInteger(value) && value >= 0
}

/**
 * Checks an arriving range against the file it claims to belong to.
 *
 * Called before anything is written, so a client asking for something the file
 * cannot hold leaves the session in the state it was already in rather than
 * half edited.
 */
function assertRange(session: UploadSession, start: number, end: number): void {
    if (!isWholeNumber(start) || !isWholeNumber(end)) {
        throw new Error("Chunk bounds must be whole byte offsets")
    }
    if (end < start) {
        throw new Error("Chunk ends before it starts")
    }
    if (end > session.totalSize - 1) {
        throw new Error("Chunk reaches past the end of the file")
    }
}

/**
 * Folds one range into a sorted list, keeping it disjoint.
 *
 * Two ranges join when they overlap and also when they merely touch, since
 * bytes 0 to 9 followed by 10 to 19 is one run of twenty bytes and a client
 * resuming from it should be told so.
 */
function mergeInto(held: ByteRange[], incoming: ByteRange): ByteRange[] {
    const all = [...held, incoming].sort((a, b) => a.start - b.start)
    const merged: ByteRange[] = []

    for (const range of all) {
        const last = merged[merged.length - 1]
        if (last && range.start <= last.end + 1) {
            last.end = Math.max(last.end, range.end)
        } else {
            merged.push({ start: range.start, end: range.end })
        }
    }
    return merged
}

/**
 * Opens a session for a file of a known size. Nothing has arrived yet, so the
 * received list starts empty and the session counts as active from startedAt.
 */
export function createUploadSession(
    id: string,
    userId: string,
    filename: string,
    totalSize: number,
    startedAt: number,
): UploadSession {
    const name = filename.trim()
    if (!name) {
        throw new Error("Upload session needs a filename")
    }
    if (!isWholeNumber(totalSize) || totalSize < 1) {
        throw new Error("Upload session needs a positive total size")
    }
    if (totalSize > MAX_FILE_SIZE) {
        throw new Error("File size exceeds the limit of 250MB")
    }

    return {
        id,
        userId,
        filename: name,
        totalSize,
        startedAt,
        updatedAt: startedAt,
        received: [],
        flushedParts: [],
    }
}

/**
 * Folds one arrived range into the session.
 *
 * Ranges may arrive in any order, may overlap what is already held, and may sit
 * directly against a neighbour; the stored list stays sorted, disjoint and with
 * no two entries touching, so a byte delivered twice is still one byte.
 *
 * Bounds are checked before anything moves. A client that asks for something
 * the file cannot hold gets an error and a session in the state it was already
 * in, rather than half an edit it has no way to see.
 */
export function recordChunk(
    session: UploadSession,
    start: number,
    end: number,
    at: number,
): void {
    assertRange(session, start, end)

    session.received = mergeInto(session.received, { start, end })
    session.updatedAt = at
}

/**
 * Bytes held, counted once each however many times they were delivered.
 *
 * A client that lost its connection mid-request often resends a range it had
 * already finished, so the raw sum of what arrived overstates progress; the
 * held list is disjoint, which makes this the honest figure to bill and to
 * report.
 */
function heldBytes(session: UploadSession): number {
    let held = 0
    for (const range of session.received) {
        held += range.end - range.start + 1
    }
    return held
}

/**
 * Where a resuming client carries on from: the first offset that has not
 * arrived. A file missing its opening byte resumes at zero however much of the
 * tail is already held.
 */
function resumeOffset(session: UploadSession): number {
    const first = session.received[0]
    if (!first || first.start !== 0) {
        return 0
    }
    return first.end + 1
}

/** The holes below the end of the file, in offset order. */
function gapsOf(session: UploadSession): ByteRange[] {
    const gaps: ByteRange[] = []
    let cursor = 0

    for (const range of session.received) {
        if (range.start > cursor) {
            gaps.push({ start: cursor, end: range.start - 1 })
        }
        cursor = range.end + 1
    }
    if (cursor <= session.totalSize - 1) {
        gaps.push({ start: cursor, end: session.totalSize - 1 })
    }
    return gaps
}

/** What a client asking after a broken upload is told. */
export function uploadStatus(session: UploadSession): UploadStatus {
    const receivedBytes = heldBytes(session)
    return {
        receivedBytes,
        nextOffset: resumeOffset(session),
        missing: gapsOf(session),
        complete: receivedBytes === session.totalSize,
    }
}
