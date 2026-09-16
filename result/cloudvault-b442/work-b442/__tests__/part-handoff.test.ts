import { createUploadSession, recordChunk, uploadStatus } from "../lib/upload-session"
import { createSessionStore, getSession, openSession, sweepSessions } from "../lib/upload-store"
import { assembleUpload } from "../lib/upload-assembly"

const PART = 45 * 1024 * 1024
const HOUR = 60 * 60 * 1000
const T0 = 1_700_000_000_000

function open(id: string, userId = "user-1", startedAt = T0, totalSize = 1000, filename = "clip.mp4") {
    return createUploadSession(id, userId, filename, totalSize, startedAt)
}

/** How much a stored session is holding, or null when the store has none. */
function heldBy(found: ReturnType<typeof getSession>): number | null {
    return found === null ? null : uploadStatus(found).receivedBytes
}

function filled(totalSize: number, filename = "clip.mp4") {
    const session = createUploadSession("done", "user-1", filename, totalSize, T0)
    recordChunk(session, 0, totalSize - 1, T0 + 10)
    return session
}

describe("holding open sessions", () => {
    it("gives a session back to the account that opened it", () => {
        const store = createSessionStore()
        const session = open("a")
        recordChunk(session, 0, 99, T0 + 10)
        openSession(store, session, T0)

        expect(heldBy(getSession(store, "user-1", "a", T0 + 20))).toBe(100)
    })

    it("hides a session from another account", () => {
        const store = createSessionStore()
        openSession(store, open("a"), T0)

        expect(getSession(store, "user-2", "a", T0)).toBeNull()
    })

    it("answers nothing for an id it never took", () => {
        const store = createSessionStore()

        expect(getSession(store, "user-1", "missing", T0)).toBeNull()
    })

    it("hides a session on the six hour mark itself", () => {
        const store = createSessionStore()
        openSession(store, open("a"), T0)

        expect(getSession(store, "user-1", "a", T0 + 6 * HOUR)).toBeNull()
    })

    it("keeps a session a millisecond short of the mark", () => {
        const store = createSessionStore()
        openSession(store, open("a"), T0)

        expect(getSession(store, "user-1", "a", T0 + 6 * HOUR - 1)).not.toBeNull()
    })

    it("keeps a session that has been quiet for an hour", () => {
        const store = createSessionStore()
        openSession(store, open("a"), T0)

        expect(getSession(store, "user-1", "a", T0 + HOUR)).not.toBeNull()
    })

    it("measures the quiet from the last chunk, not from the start", () => {
        const store = createSessionStore()
        const session = open("a")
        openSession(store, session, T0)
        recordChunk(session, 0, 99, T0 + 5 * HOUR)

        expect(heldBy(getSession(store, "user-1", "a", T0 + 10 * HOUR))).toBe(100)
    })

    it("counts a range that adds nothing as activity all the same", () => {
        const store = createSessionStore()
        const session = open("a")
        openSession(store, session, T0)
        recordChunk(session, 0, 99, T0 + HOUR)
        recordChunk(session, 0, 99, T0 + 5 * HOUR)

        expect(getSession(store, "user-1", "a", T0 + 10 * HOUR)).not.toBeNull()
    })

    it("does not count a refused range as activity", () => {
        const store = createSessionStore()
        const session = open("a")
        openSession(store, session, T0)
        recordChunk(session, 0, 99, T0)
        try {
            recordChunk(session, 900, 1000, T0 + 5 * HOUR)
        } catch (error) {
            /* the refusal is the point */
        }

        expect(getSession(store, "user-1", "a", T0 + 8 * HOUR)).toBeNull()
    })

    it("does not count a backwards range as activity either", () => {
        const store = createSessionStore()
        const session = open("a")
        openSession(store, session, T0)
        recordChunk(session, 0, 99, T0)
        try {
            recordChunk(session, 500, 499, T0 + 5 * HOUR)
        } catch (error) {
            /* the refusal is the point */
        }

        expect(getSession(store, "user-1", "a", T0 + 8 * HOUR)).toBeNull()
    })

    it("refuses a fifth upload in flight", () => {
        const store = createSessionStore()
        for (const id of ["a", "b", "c", "d"]) {
            openSession(store, open(id), T0)
        }

        expect(() => openSession(store, open("e"), T0)).toThrow()
    })

    it("lets an account through once one of its sessions has gone idle", () => {
        const store = createSessionStore()
        for (const id of ["a", "b", "c", "d"]) {
            openSession(store, open(id, "user-1", T0), T0)
        }
        const alive = open("d2", "user-1", T0 + 8 * HOUR)
        recordChunk(alive, 0, 99, T0 + 8 * HOUR)

        openSession(store, alive, T0 + 8 * HOUR)
        expect(heldBy(getSession(store, "user-1", "d2", T0 + 8 * HOUR))).toBe(100)
    })

    it("counts each account's sessions against its own place", () => {
        const store = createSessionStore()
        for (const id of ["a", "b", "c", "d"]) {
            openSession(store, open(id, "user-1"), T0)
        }
        openSession(store, open("other", "user-2"), T0)

        expect(getSession(store, "user-2", "other", T0)).not.toBeNull()
    })
})

describe("clearing sessions out", () => {
    it("reports what the sweep dropped", () => {
        const store = createSessionStore()
        openSession(store, open("stale"), T0)

        expect(sweepSessions(store, T0 + 8 * HOUR)).toEqual(["stale"])
    })

    it("sweeps a session sitting exactly on the mark", () => {
        const store = createSessionStore()
        openSession(store, open("stale"), T0)

        expect(sweepSessions(store, T0 + 6 * HOUR)).toEqual(["stale"])
    })

    it("leaves live sessions where they are", () => {
        const store = createSessionStore()
        const live = open("live")
        recordChunk(live, 0, 49, T0 + 10)
        openSession(store, live, T0)
        sweepSessions(store, T0 + HOUR)

        expect(heldBy(getSession(store, "user-1", "live", T0 + HOUR))).toBe(50)
    })

    it("sweeps across accounts in one pass", () => {
        const store = createSessionStore()
        openSession(store, open("b-stale", "user-2"), T0)
        openSession(store, open("a-stale", "user-1"), T0)

        expect(sweepSessions(store, T0 + 7 * HOUR)).toEqual(["a-stale", "b-stale"])
    })

})

describe("assembling the finished file", () => {
    it("refuses a session with bytes still outstanding", () => {
        const session = open("a")
        recordChunk(session, 0, 499, T0 + 10)

        expect(() => assembleUpload(session, [{ index: 0, fileId: "f", filePath: "documents/f" }])).toThrow()
    })

    it("takes its identifiers from the only part of a small file", () => {
        const record = assembleUpload(filled(1000), [
            { index: 0, fileId: "file-7", filePath: "documents/file_7" },
        ])

        expect(record).toMatchObject({ fileId: "file-7", filePath: "documents/file_7" })
    })

    it("carries the filename and its extension", () => {
        const record = assembleUpload(filled(1000, "Holiday.MP4"), [
            { index: 0, fileId: "file-7", filePath: "documents/file_7" },
        ])

        expect(record).toMatchObject({ originalFilename: "Holiday.MP4", extension: "mp4" })
    })

    it("reports the size the session was opened for", () => {
        const record = assembleUpload(filled(1234), [
            { index: 0, fileId: "file-7", filePath: "documents/file_7" },
        ])

        expect(record.size).toBe(1234)
    })

    it("leaves a one part file without a chunk list", () => {
        const record = assembleUpload(filled(1000), [
            { index: 0, fileId: "file-7", filePath: "documents/file_7" },
        ])

        expect(record.chunks).toBeUndefined()
    })

    it("leaves a one part file without a chunk path list", () => {
        const record = assembleUpload(filled(1000), [
            { index: 0, fileId: "file-7", filePath: "documents/file_7" },
        ])

        expect(record.chunkPaths).toBeUndefined()
    })

    it("lists a cut up file's parts in part order", () => {
        const record = assembleUpload(filled(PART + 500), [
            { index: 1, fileId: "tail", filePath: "documents/tail" },
            { index: 0, fileId: "head", filePath: "documents/head" },
        ])

        expect(record.chunks).toEqual(["head", "tail"])
    })

    it("lists the paths in the same order", () => {
        const record = assembleUpload(filled(PART + 500), [
            { index: 1, fileId: "tail", filePath: "documents/tail" },
            { index: 0, fileId: "head", filePath: "documents/head" },
        ])

        expect(record.chunkPaths).toEqual(["documents/head", "documents/tail"])
    })

    it("stands the first part in for the file itself", () => {
        const record = assembleUpload(filled(PART + 500), [
            { index: 1, fileId: "tail", filePath: "documents/tail" },
            { index: 0, fileId: "head", filePath: "documents/head" },
        ])

        expect(record).toMatchObject({ fileId: "head", filePath: "documents/head" })
    })

    it("refuses a result list with a part missing", () => {
        expect(() =>
            assembleUpload(filled(PART + 500), [{ index: 0, fileId: "head", filePath: "documents/head" }]),
        ).toThrow()
    })

    it("refuses a part reported twice", () => {
        expect(() =>
            assembleUpload(filled(PART + 500), [
                { index: 0, fileId: "head", filePath: "documents/head" },
                { index: 0, fileId: "again", filePath: "documents/again" },
            ]),
        ).toThrow()
    })

    it("refuses a part the file does not have", () => {
        expect(() =>
            assembleUpload(filled(1000), [
                { index: 0, fileId: "head", filePath: "documents/head" },
                { index: 1, fileId: "ghost", filePath: "documents/ghost" },
            ]),
        ).toThrow()
    })
})

describe("guarding session ids", () => {
    it("refuses an id the store is already holding", () => {
        const store = createSessionStore()
        openSession(store, open("a"), T0)

        expect(() => openSession(store, open("a"), T0)).toThrow()
    })

    it("keeps the session that was already open", () => {
        const store = createSessionStore()
        const first = open("a")
        recordChunk(first, 0, 24, T0 + 10)
        openSession(store, first, T0)
        try {
            openSession(store, open("a"), T0)
        } catch (error) {
            /* the refusal is the point */
        }

        expect(heldBy(getSession(store, "user-1", "a", T0 + 20))).toBe(25)
    })
})
