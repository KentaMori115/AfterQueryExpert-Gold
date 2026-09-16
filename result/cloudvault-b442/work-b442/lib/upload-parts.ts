// The fixed grid a session is flushed onto.
//
// Telegram takes one document per message, so a large file reaches it as a run
// of 45MB parts. A part can only be sent once every byte of it has arrived,
// which is rarely the moment a chunk lands: a client sending 10MB pieces fills
// part 0 after four and a half of them, and a piece that straddles a boundary
// leaves both sides short.
//
// The grid is a property of the file's size alone, not of how the bytes were
// delivered, so two clients uploading the same file in different pieces still
// produce the same parts under the same names. That is what lets a resumed
// upload finish what an abandoned one started.

import { MAX_PART_SIZE, type UploadSession } from "./upload-session"

export interface FilePart {
    index: number
    start: number
    end: number
}

/**
 * Cuts a file of this size into the parts it will be sent as.
 *
 * Every part but the last is a full 45MB, the last is whatever remains, and a
 * file that fits inside one part is a single part covering all of it.
 */
export function partsFor(totalSize: number): FilePart[] {
    const parts: FilePart[] = []
    let start = 0
    let index = 0

    while (start < totalSize) {
        const end = Math.min(start + MAX_PART_SIZE, totalSize) - 1
        parts.push({ index, start, end })
        start = end + 1
        index += 1
    }
    return parts
}

// The name a part travels under. A file small enough to go in one piece keeps
// its own name, the way a single-shot upload sends it; anything cut up carries
// the part it is and the count it belongs to.
function partFilename(filename: string, index: number, total: number): string {
    if (total <= 1) {
        return filename
    }
    return `${filename}.part${index + 1}_of_${total}`
}

// Whether one run of held bytes spans the whole part. The session merges what
// it receives, so a part filled by five separate arrivals is one run by the
// time this is asked; a part missing a byte anywhere inside it is not covered
// by any run, however much of it has arrived.
function covers(session: UploadSession, part: FilePart): boolean {
    for (const range of session.received) {
        if (range.start <= part.start && range.end >= part.end) {
            return true
        }
    }
    return false
}

// Parts that are whole and have not been handed over yet, lowest first. A part
// held together out of several chunks counts, since the session merges what it
// receives; a part still missing a byte anywhere inside it does not.
function readyParts(session: UploadSession): number[] {
    const ready: number[] = []

    for (const part of partsFor(session.totalSize)) {
        if (session.flushedParts.includes(part.index)) {
            continue
        }
        if (covers(session, part)) {
            ready.push(part.index)
        }
    }
    return ready
}

export interface PartUploadPlan {
    index: number
    name: string
    start: number
    end: number
    size: number
}

/**
 * What to send to Telegram now, and the record that it has been sent.
 *
 * The whole parts are handed over lowest first, each with the byte window to
 * read out of the file and the name it travels under, and are marked off as
 * they go: asking again gives the caller only what became whole in between, so
 * no part is sent twice. The names count against the parts the file has, not
 * against how many happen to be ready.
 */
export function nextUploadBatch(session: UploadSession): PartUploadPlan[] {
    const parts = partsFor(session.totalSize)
    const batch: PartUploadPlan[] = []

    for (const index of readyParts(session)) {
        const part = parts[index]
        batch.push({
            index,
            name: partFilename(session.filename, index, parts.length),
            start: part.start,
            end: part.end,
            size: part.end - part.start + 1,
        })
        session.flushedParts.push(index)
    }
    session.flushedParts.sort((a, b) => a - b)
    return batch
}
