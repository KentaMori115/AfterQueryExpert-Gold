import { MAX_FILE_SIZE } from "../lib/file-utils"
import {
    createUploadSession,
    recordChunk,
    uploadStatus,
} from "../lib/upload-session"
import { nextUploadBatch, partsFor } from "../lib/upload-parts"

const PART = 45 * 1024 * 1024
const T0 = 1_700_000_000_000

function session(totalSize: number, filename = "holiday.mp4") {
    return createUploadSession("s-1", "user-1", filename, totalSize, T0)
}

describe("opening a session", () => {
    it("starts with nothing received", () => {
        const s = session(1000)

        expect(uploadStatus(s).receivedBytes).toBe(0)
    })

    it("counts the whole file as outstanding", () => {
        const s = session(1000)

        expect(uploadStatus(s).missing).toEqual([{ start: 0, end: 999 }])
    })

    it("trims the filename it was handed", () => {
        const s = session(1000, "  report.pdf  ")
        recordChunk(s, 0, 999, T0 + 10)

        expect(nextUploadBatch(s)[0].name).toBe("report.pdf")
    })

    it("refuses a filename that is only spaces", () => {
        expect(() => session(1000, "   ")).toThrow()
    })

    it("refuses a size of zero", () => {
        expect(() => session(0)).toThrow()
    })

    it("refuses a size that is not a whole number of bytes", () => {
        expect(() => session(1024.5)).toThrow()
    })

    it("refuses a file past the ceiling the service already sets", () => {
        expect(() => session(MAX_FILE_SIZE + 1)).toThrow()
    })

    it("accepts a file sitting exactly on that ceiling", () => {
        expect(() => session(MAX_FILE_SIZE)).not.toThrow()
    })
})

describe("recording arrived ranges", () => {
    it("holds the bytes of a single range", () => {
        const s = session(1000)
        recordChunk(s, 0, 99, T0 + 10)

        expect(uploadStatus(s).receivedBytes).toBe(100)
    })

    it("resumes after the last byte of a leading range", () => {
        const s = session(1000)
        recordChunk(s, 0, 99, T0 + 10)

        expect(uploadStatus(s).nextOffset).toBe(100)
    })

    it("merges ranges that arrive out of order", () => {
        const s = session(300)
        recordChunk(s, 200, 299, T0 + 10)
        recordChunk(s, 0, 199, T0 + 20)

        expect(uploadStatus(s).missing).toEqual([])
    })

    it("joins two ranges that sit directly against each other", () => {
        const s = session(1000)
        recordChunk(s, 0, 9, T0 + 10)
        recordChunk(s, 10, 19, T0 + 20)

        expect(uploadStatus(s).nextOffset).toBe(20)
    })

    it("leaves a one byte hole between ranges alone", () => {
        const s = session(1000)
        recordChunk(s, 0, 9, T0 + 10)
        recordChunk(s, 11, 19, T0 + 20)

        expect(uploadStatus(s).missing[0]).toEqual({ start: 10, end: 10 })
    })

    it("counts a byte delivered twice only once", () => {
        const s = session(1000)
        recordChunk(s, 0, 99, T0 + 10)
        recordChunk(s, 50, 149, T0 + 20)

        expect(uploadStatus(s).receivedBytes).toBe(150)
    })

    it("swallows a range already held whole", () => {
        const s = session(1000)
        recordChunk(s, 0, 199, T0 + 10)
        recordChunk(s, 50, 99, T0 + 20)

        expect(uploadStatus(s).receivedBytes).toBe(200)
    })

    it("keeps one run when a range lands inside another", () => {
        const s = session(1000)
        recordChunk(s, 0, 199, T0 + 10)
        recordChunk(s, 50, 99, T0 + 20)

        expect(uploadStatus(s).nextOffset).toBe(200)
    })

    it("refuses a range reaching past the last byte", () => {
        const s = session(1000)

        expect(() => recordChunk(s, 900, 1000, T0 + 10)).toThrow()
    })

    it("keeps the session untouched when a range is refused", () => {
        const s = session(1000)
        recordChunk(s, 0, 99, T0 + 10)
        try {
            recordChunk(s, 900, 1000, T0 + 20)
        } catch (error) {
            /* the refusal is the point */
        }

        expect(uploadStatus(s).receivedBytes).toBe(100)
    })

    it("refuses a range that ends before it starts", () => {
        const s = session(1000)

        expect(() => recordChunk(s, 500, 499, T0 + 10)).toThrow()
    })

    it("keeps the holes it had when a backwards range is refused", () => {
        const s = session(1000)
        recordChunk(s, 0, 99, T0 + 10)
        try {
            recordChunk(s, 500, 499, T0 + 20)
        } catch (error) {
            /* the refusal is the point */
        }

        expect(uploadStatus(s).missing).toEqual([{ start: 100, end: 999 }])
    })

    it("refuses a negative offset", () => {
        const s = session(1000)

        expect(() => recordChunk(s, -1, 99, T0 + 10)).toThrow()
    })

    it("refuses a fractional offset", () => {
        const s = session(1000)

        expect(() => recordChunk(s, 0, 99.5, T0 + 10)).toThrow()
    })

    it("holds no bytes from a range on fractional offsets", () => {
        const s = session(1000)
        recordChunk(s, 0, 99, T0 + 10)
        try {
            recordChunk(s, 100, 199.5, T0 + 20)
        } catch (error) {
            /* the refusal is the point */
        }

        expect(uploadStatus(s).receivedBytes).toBe(100)
    })

    it("leaves the resume point where it was after a refusal", () => {
        const s = session(1000)
        recordChunk(s, 0, 99, T0 + 10)
        try {
            recordChunk(s, -5, 200, T0 + 20)
        } catch (error) {
            /* the refusal is the point */
        }

        expect(uploadStatus(s).nextOffset).toBe(100)
    })
})

describe("what a resuming client is told", () => {
    it("reports the whole file missing before anything arrives", () => {
        const s = session(500)

        expect(uploadStatus(s).missing).toEqual([{ start: 0, end: 499 }])
    })

    it("resumes at zero while the opening byte is absent", () => {
        const s = session(1000)
        recordChunk(s, 1, 999, T0 + 10)

        expect(uploadStatus(s).nextOffset).toBe(0)
    })

    it("lists the holes in offset order", () => {
        const s = session(1000)
        recordChunk(s, 400, 499, T0 + 10)
        recordChunk(s, 0, 99, T0 + 20)

        expect(uploadStatus(s).missing).toEqual([
            { start: 100, end: 399 },
            { start: 500, end: 999 },
        ])
    })

    it("counts the tail as missing up to the last byte", () => {
        const s = session(1000)
        recordChunk(s, 0, 899, T0 + 10)

        expect(uploadStatus(s).missing).toEqual([{ start: 900, end: 999 }])
    })

    it("stays incomplete while one byte is outstanding", () => {
        const s = session(1000)
        recordChunk(s, 0, 998, T0 + 10)

        expect(uploadStatus(s).complete).toBe(false)
    })

    it("completes once every byte is held", () => {
        const s = session(1000)
        recordChunk(s, 500, 999, T0 + 10)
        recordChunk(s, 0, 499, T0 + 20)

        expect(uploadStatus(s).complete).toBe(true)
    })

    it("reports no holes in a complete file", () => {
        const s = session(1000)
        recordChunk(s, 0, 999, T0 + 10)

        expect(uploadStatus(s).missing).toEqual([])
    })
})

describe("cutting a file into parts", () => {
    it("gives a small file one part covering all of it", () => {
        expect(partsFor(1000)).toEqual([{ index: 0, start: 0, end: 999 }])
    })

    it("keeps a file sitting exactly on the part size in one piece", () => {
        expect(partsFor(PART)).toHaveLength(1)
    })

    it("splits one byte more into two", () => {
        expect(partsFor(PART + 1)).toEqual([
            { index: 0, start: 0, end: PART - 1 },
            { index: 1, start: PART, end: PART },
        ])
    })

    it("ends the last part on the last byte of the file", () => {
        const parts = partsFor(PART * 2 + 500)

        expect(parts[parts.length - 1].end).toBe(PART * 2 + 499)
    })

    it("leaves no gap between one part and the next", () => {
        const parts = partsFor(PART * 3 + 7)
        const gaps = parts.filter((part, index) => index > 0 && part.start !== parts[index - 1].end + 1)

        expect(gaps).toEqual([])
    })
})

describe("handing parts on to Telegram", () => {
    it("holds a part back while it is short of bytes", () => {
        const s = session(PART * 2)
        recordChunk(s, 0, PART - 2, T0 + 10)

        expect(nextUploadBatch(s)).toEqual([])
    })

    it("releases a part filled by several arrivals", () => {
        const s = session(PART * 2)
        recordChunk(s, 0, 999, T0 + 10)
        recordChunk(s, 1000, PART - 1, T0 + 20)

        expect(nextUploadBatch(s).map((part) => part.index)).toEqual([0])
    })

    it("releases neither side of a range straddling the boundary", () => {
        const s = session(PART * 2)
        recordChunk(s, PART - 1000, PART + 1000, T0 + 10)

        expect(nextUploadBatch(s)).toEqual([])
    })

    it("hands over whole parts lowest first however they filled", () => {
        const s = session(PART * 3)
        recordChunk(s, PART * 2, PART * 3 - 1, T0 + 10)
        recordChunk(s, 0, PART - 1, T0 + 20)

        expect(nextUploadBatch(s).map((part) => part.index)).toEqual([0, 2])
    })

    it("names a part against the count the file has, not the count ready", () => {
        const s = session(PART * 3)
        recordChunk(s, PART * 2, PART * 3 - 1, T0 + 10)

        expect(nextUploadBatch(s)[0].name).toBe("holiday.mp4.part3_of_3")
    })

    it("leaves a single part file under its own name", () => {
        const s = session(1000)
        recordChunk(s, 0, 999, T0 + 10)

        expect(nextUploadBatch(s)[0].name).toBe("holiday.mp4")
    })

    it("carries the byte window of the part", () => {
        const s = session(PART * 2)
        recordChunk(s, 0, PART - 1, T0 + 10)

        expect(nextUploadBatch(s)[0]).toMatchObject({ index: 0, start: 0, end: PART - 1, size: PART })
    })

    it("sizes the short final part by what is left", () => {
        const s = session(PART + 500)
        recordChunk(s, 0, PART + 499, T0 + 10)

        expect(nextUploadBatch(s)[1].size).toBe(500)
    })

    it("does not offer a part a second time", () => {
        const s = session(PART * 2)
        recordChunk(s, 0, PART - 1, T0 + 10)
        nextUploadBatch(s)

        expect(nextUploadBatch(s)).toEqual([])
    })

    it("offers only what became whole since the last batch", () => {
        const s = session(PART * 2)
        recordChunk(s, 0, PART - 1, T0 + 10)
        nextUploadBatch(s)
        recordChunk(s, PART, PART * 2 - 1, T0 + 20)

        expect(nextUploadBatch(s).map((part) => part.index)).toEqual([1])
    })

    it("leaves a part alone while the range covering it stops short", () => {
        const s = session(PART * 3)
        recordChunk(s, 0, PART * 2 - 2, T0 + 10)

        expect(nextUploadBatch(s).map((part) => part.index)).toEqual([0])
    })
})
