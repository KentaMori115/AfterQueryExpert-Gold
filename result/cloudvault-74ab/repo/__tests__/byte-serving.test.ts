import { planRangedResponse } from "../lib/range-plan"

// WIDE was stored in eight equal chunks, DEEP under a part limit that changed
// twice, and TINY holds five bytes in two chunks.
const WIDE = {
    chunkSizes: [300, 300, 300, 300, 300, 300, 300, 300],
    contentType: "image/png",
}
const DEEP = { chunkSizes: [12, 4096, 7, 65536, 3], contentType: "application/pdf" }
const TINY = { chunkSizes: [3, 2], contentType: "text/plain" }

const SHORT = "x"
const BOUNDARY = "cvbound"
const LONG = "cloudvault-71f3c0"

describe("what a gap costs at one digit", () => {
    it("crosses a gap of seventy one between single-digit offsets", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-9,81-180", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentRange).toBe("bytes 0-180/2400")
        expect(plan.contentLength).toBe(181)
    })

    it("keeps a gap of seventy two between the same offsets", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-9,82-181", BOUNDARY)
        expect(plan.parts).toHaveLength(2)
        expect(plan.contentLength).toBe(268)
        expect(plan.bytesServed).toBe(110)
    })
})

describe("what a gap costs at two digits", () => {
    it("crosses a gap of seventy three when the offset either side is wider", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-99,173-272", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentRange).toBe("bytes 0-272/2400")
    })

    it("keeps a gap of seventy four there", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-99,174-273", BOUNDARY)
        expect(plan.parts).toHaveLength(2)
        expect(plan.contentLength).toBe(360)
    })
})

describe("what a gap costs at four digits", () => {
    it("crosses a gap of seventy five once the offsets run to four digits", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-999,1075-1174", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentLength).toBe(1175)
    })

    it("keeps a gap of seventy six there", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-999,1076-1175", BOUNDARY)
        expect(plan.parts).toHaveLength(2)
        expect(plan.contentLength).toBe(1263)
        expect(plan.bytesServed).toBe(1100)
    })
})

describe("the boundary decides what a gap is worth", () => {
    it("keeps a gap of seventy four behind a one-letter boundary", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-9,84-183", SHORT)
        expect(plan.parts).toHaveLength(2)
        expect(plan.contentLength).toBe(250)
        expect(plan.contentType).toBe("multipart/byteranges; boundary=x")
    })

    it("keeps the same gap behind a seven-letter boundary", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-9,84-183", BOUNDARY)
        expect(plan.parts).toHaveLength(2)
        expect(plan.contentLength).toBe(268)
    })

    it("crosses it behind a seventeen-letter boundary", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-9,84-183", LONG)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentRange).toBe("bytes 0-183/2400")
        expect(plan.contentLength).toBe(184)
    })
})

describe("gaps crossed one after another", () => {
    it("runs four stretches into one", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-99,173-272,346-445,519-618", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentRange).toBe("bytes 0-618/2400")
        expect(plan.bytesServed).toBe(619)
    })

})

describe("chunks of wildly unequal size", () => {
    it("reads inside the first, smallest chunk", () => {
        const plan = planRangedResponse(DEEP, "bytes=0-11", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([{ chunk: 0, offset: 0, length: 12 }])
    })

    it("starts on the first byte of the chunk after a short one", () => {
        const plan = planRangedResponse(DEEP, "bytes=12-12", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([{ chunk: 1, offset: 0, length: 1 }])
    })

    it("crosses three chunks, one of them seven bytes long", () => {
        const plan = planRangedResponse(DEEP, "bytes=4100-4115", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 1, offset: 4088, length: 8 },
            { chunk: 2, offset: 0, length: 7 },
            { chunk: 3, offset: 0, length: 1 },
        ])
    })

    it("leaves the seven-byte chunk for the one behind it", () => {
        const plan = planRangedResponse(DEEP, "bytes=4114-4116", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 2, offset: 6, length: 1 },
            { chunk: 3, offset: 0, length: 2 },
        ])
    })

    it("reaches the last byte of the last chunk", () => {
        const plan = planRangedResponse(DEEP, "bytes=69653-", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 69653-69653/69654")
        expect(plan.parts[0].reads).toEqual([{ chunk: 4, offset: 2, length: 1 }])
    })

    it("measures a body whose first stretch crosses a chunk", () => {
        const plan = planRangedResponse(DEEP, "bytes=0-99,300-399", BOUNDARY)
        expect(plan.contentLength).toBe(374)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 0, offset: 0, length: 12 },
            { chunk: 1, offset: 0, length: 88 },
        ])
    })

})

describe("a file of five bytes", () => {
    it("serves it whole by range", () => {
        const plan = planRangedResponse(TINY, "bytes=0-4", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 0-4/5")
        expect(plan.parts[0].reads).toEqual([
            { chunk: 0, offset: 0, length: 3 },
            { chunk: 1, offset: 0, length: 2 },
        ])
    })

    it("crosses its own boundary for two bytes", () => {
        const plan = planRangedResponse(TINY, "bytes=2-3", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 0, offset: 2, length: 1 },
            { chunk: 1, offset: 0, length: 1 },
        ])
    })

    it("takes its last byte as a suffix", () => {
        const plan = planRangedResponse(TINY, "bytes=-1", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 4-4/5")
        expect(plan.parts[0].reads).toEqual([{ chunk: 1, offset: 1, length: 1 }])
    })

    it("crosses the whole of itself to join its two ends", () => {
        const plan = planRangedResponse(TINY, "bytes=0-0,4-4", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentRange).toBe("bytes 0-4/5")
        expect(plan.bytesServed).toBe(5)
    })
})

describe("members measured against a wider file", () => {

    it("walks all eight chunks for the whole file", () => {
        const plan = planRangedResponse(WIDE, "bytes=0-2399", BOUNDARY)
        expect(plan.parts[0].reads).toHaveLength(8)
        expect(plan.contentLength).toBe(2400)
    })
})
