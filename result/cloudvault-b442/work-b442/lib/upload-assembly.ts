// Turning a finished session into the file record the rest of the service
// already reads.
//
// The upload route stores one canonical metadata document per file, and a
// chunked file is described there by its parts: the first part's identifiers
// stand for the file, and the full lists sit alongside them in part order. A
// file that went up in one piece carries no lists at all, and the download path
// tells the two apart by exactly that.

import { getExtension } from "./file-utils"
import { partsFor, type FilePart } from "./upload-parts"
import { uploadStatus, type UploadSession } from "./upload-session"

export interface PartUpload {
    index: number
    fileId: string
    filePath: string
}

export interface AssembledUpload {
    fileId: string
    filePath: string
    originalFilename: string
    extension: string
    size: number
    chunks?: string[]
    chunkPaths?: string[]
}

/**
 * Builds the metadata for a completed session.
 *
 * Every part has to be accounted for exactly once, and the session itself has
 * to be whole: a record written for a file that is still missing bytes would
 * serve a truncated download for as long as it sat in the collection.
 */
/**
 * Puts the results in part order, refusing anything that would leave the file
 * unservable.
 *
 * Telegram hands an identifier back per message, in whatever order the sends
 * finished, so what arrives here is a bag rather than a sequence. A part named
 * twice, a part the file does not have, and a part nobody reported are all
 * failures of the same kind: the download path walks the lists by position, and
 * a list that does not line up with the grid serves the wrong bytes.
 */
function orderResults(parts: FilePart[], uploaded: PartUpload[]): PartUpload[] {
    const byIndex = new Map<number, PartUpload>()

    for (const result of uploaded) {
        const known =
            Number.isInteger(result.index) && result.index >= 0 && result.index < parts.length
        if (!known) {
            throw new Error("Upload result names a part the file does not have")
        }
        if (byIndex.has(result.index)) {
            throw new Error("Upload result reports a part twice")
        }
        byIndex.set(result.index, result)
    }
    if (byIndex.size !== parts.length) {
        throw new Error("Upload result is missing a part")
    }
    return parts.map((part) => byIndex.get(part.index)!)
}

export function assembleUpload(session: UploadSession, uploaded: PartUpload[]): AssembledUpload {
    if (!uploadStatus(session).complete) {
        throw new Error("Upload session is not complete")
    }

    const parts = partsFor(session.totalSize)
    const ordered = orderResults(parts, uploaded)
    const first = ordered[0]
    const record: AssembledUpload = {
        fileId: first.fileId,
        filePath: first.filePath,
        originalFilename: session.filename,
        extension: getExtension(session.filename),
        size: session.totalSize,
    }

    if (ordered.length > 1) {
        record.chunks = ordered.map((part) => part.fileId)
        record.chunkPaths = ordered.map((part) => part.filePath)
    }
    return record
}
