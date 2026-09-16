import { planRangedResponse } from "../lib/range-plan"

// Three stored files. MEDIA is the ordinary chunked upload, SMALL is small
// enough to reason about by hand, UNEVEN was stored under a part limit that has
// since changed and keeps the sizes it was uploaded with.
const MEDIA = { chunkSizes: [1000, 1000, 537], contentType: "video/mp4" }
const SMALL = { chunkSizes: [64, 64, 32], contentType: "text/plain" }
const UNEVEN = { chunkSizes: [7, 300, 1, 892], contentType: "application/octet-stream" }
const ONE = { chunkSizes: [500], contentType: "application/pdf" }
const BULK = { chunkSizes: [1000, 1000, 537], contentType: "application/octet-stream" }

const BOUNDARY = "cvbound"
const LONG_BOUNDARY = "cloudvault-71f3c0"

describe("a header that asks for nothing", () => {
    it("sends the whole file when there is no header", () => {
        const plan = planRangedResponse(MEDIA, null, BOUNDARY)
        expect(plan.status).toBe(200)
        expect(plan.contentLength).toBe(2537)
        expect(plan.contentRange).toBeNull()
    })

    it("sends the whole file when the header is blank", () => {
        expect(planRangedResponse(MEDIA, "   ", BOUNDARY)).toMatchObject({ status: 200, contentLength: 2537 })
    })

    it("sends the whole file when the header is undefined", () => {
        expect(planRangedResponse(MEDIA, undefined, BOUNDARY)).toMatchObject({ status: 200, bytesServed: 2537 })
    })

    it("keeps the file's own type on a whole-file answer", () => {
        const plan = planRangedResponse(MEDIA, null, BOUNDARY)
        expect(plan.contentType).toBe("video/mp4")
        expect(plan.contentLength).toBe(2537)
    })

    it("counts every byte as served on a whole-file answer", () => {
        expect(planRangedResponse(MEDIA, null, BOUNDARY).bytesServed).toBe(2537)
    })

    it("covers a file stored in chunks of unequal size", () => {
        const plan = planRangedResponse(UNEVEN, null, BOUNDARY)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 0, offset: 0, length: 7 },
            { chunk: 1, offset: 0, length: 300 },
            { chunk: 2, offset: 0, length: 1 },
            { chunk: 3, offset: 0, length: 892 },
        ])
    })

    it("covers a whole-file answer with one read per chunk", () => {
        const plan = planRangedResponse(MEDIA, null, BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.parts[0].first).toBe(0)
        expect(plan.parts[0].last).toBe(2536)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 0, offset: 0, length: 1000 },
            { chunk: 1, offset: 0, length: 1000 },
            { chunk: 2, offset: 0, length: 537 },
        ])
    })
})

describe("a header read whole or not at all", () => {
    it("ignores a unit other than bytes", () => {
        expect(planRangedResponse(MEDIA, "items=0-10", BOUNDARY)).toMatchObject({ status: 200, contentLength: 2537 })
    })

    it("ignores the whole header when one member is not a range", () => {
        expect(planRangedResponse(MEDIA, "bytes=0-99,junk", BOUNDARY)).toMatchObject({ status: 200, contentLength: 2537 })
    })

    it("ignores the whole header when a member ends before it starts", () => {
        expect(planRangedResponse(MEDIA, "bytes=50-10", BOUNDARY)).toMatchObject({ status: 200, contentLength: 2537 })
    })

    it("ignores the whole header when a member is empty", () => {
        expect(planRangedResponse(MEDIA, "bytes=0-10,", BOUNDARY)).toMatchObject({ status: 200, contentLength: 2537 })
    })

    it("ignores a header with no members at all", () => {
        expect(planRangedResponse(MEDIA, "bytes=", BOUNDARY)).toMatchObject({ status: 200, contentLength: 2537 })
    })

    it("ignores a member that is a bare dash", () => {
        expect(planRangedResponse(MEDIA, "bytes=-", BOUNDARY)).toMatchObject({ status: 200, contentLength: 2537 })
    })

    it("ignores a suffix that is not a number", () => {
        expect(planRangedResponse(MEDIA, "bytes=-abc", BOUNDARY)).toMatchObject({ status: 200, contentLength: 2537 })
    })

    it("does not truncate to the members it did understand", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,junk", BOUNDARY)
        expect(plan.bytesServed).toBe(2537)
        expect(plan.contentRange).toBeNull()
    })
})

describe("one stretch of the file", () => {
    it("answers a plain range with 206 and its own content range", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99", BOUNDARY)
        expect(plan.status).toBe(206)
        expect(plan.contentRange).toBe("bytes 0-99/2537")
        expect(plan.contentLength).toBe(100)
    })

    it("keeps the file's own type for a single stretch", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99", BOUNDARY)
        expect(plan.contentType).toBe("video/mp4")
        expect(plan.contentLength).toBe(100)
    })

    it("runs an open-ended range to the last byte", () => {
        const plan = planRangedResponse(MEDIA, "bytes=2400-", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 2400-2536/2537")
        expect(plan.contentLength).toBe(137)
    })

    it("takes a suffix range off the end", () => {
        const plan = planRangedResponse(MEDIA, "bytes=-100", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 2437-2536/2537")
        expect(plan.bytesServed).toBe(100)
    })

    it("starts a suffix longer than the file at its first byte", () => {
        const plan = planRangedResponse(MEDIA, "bytes=-5000", BOUNDARY)
        expect(plan.status).toBe(206)
        expect(plan.contentRange).toBe("bytes 0-2536/2537")
    })

    it("stops a range that runs off the end at the last byte", () => {
        const plan = planRangedResponse(MEDIA, "bytes=2500-9000", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 2500-2536/2537")
        expect(plan.contentLength).toBe(37)
    })

    it("serves exactly the bytes the stretch holds", () => {
        expect(planRangedResponse(SMALL, "bytes=10-20", BOUNDARY).bytesServed).toBe(11)
    })

    it("answers a range of one byte", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-0", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 0-0/2537")
        expect(plan.contentLength).toBe(1)
    })

    it("answers a range holding only the last byte", () => {
        const plan = planRangedResponse(MEDIA, "bytes=2536-", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 2536-2536/2537")
        expect(plan.parts[0].reads).toEqual([{ chunk: 2, offset: 536, length: 1 }])
    })

    it("takes a suffix the length of the file", () => {
        const plan = planRangedResponse(MEDIA, "bytes=-2537", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 0-2536/2537")
        expect(plan.bytesServed).toBe(2537)
    })

    it("reaches the last byte of a file through an open-ended member", () => {
        const plan = planRangedResponse(SMALL, "bytes=159-", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 159-159/160")
        expect(plan.parts[0].reads).toEqual([{ chunk: 2, offset: 31, length: 1 }])
    })

    it("serves a file held in a single chunk", () => {
        const plan = planRangedResponse(ONE, "bytes=100-199", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 100-199/500")
        expect(plan.parts[0].reads).toEqual([{ chunk: 0, offset: 100, length: 100 }])
    })

    it("answers a request for the whole file by range with 206", () => {
        const plan = planRangedResponse(SMALL, "bytes=0-159", BOUNDARY)
        expect(plan.status).toBe(206)
        expect(plan.contentRange).toBe("bytes 0-159/160")
    })
})

describe("a request for bytes the file does not hold", () => {
    it("refuses a range starting past the end", () => {
        const plan = planRangedResponse(MEDIA, "bytes=5000-", BOUNDARY)
        expect(plan.status).toBe(416)
        expect(plan.contentRange).toBe("bytes */2537")
    })

    it("refuses a suffix of no bytes", () => {
        expect(planRangedResponse(MEDIA, "bytes=-0", BOUNDARY).status).toBe(416)
    })

    it("refuses a range starting on the byte after the last", () => {
        const plan = planRangedResponse(MEDIA, "bytes=2537-", BOUNDARY)
        expect(plan.status).toBe(416)
        expect(plan.contentRange).toBe("bytes */2537")
    })

    it("carries nothing on a refusal", () => {
        const plan = planRangedResponse(MEDIA, "bytes=5000-6000,9000-", BOUNDARY)
        expect(plan.status).toBe(416)
        expect(plan.parts).toHaveLength(0)
        expect(plan.contentLength).toBe(0)
        expect(plan.bytesServed).toBe(0)
    })

    it("drops the dead members and keeps the live one", () => {
        const plan = planRangedResponse(MEDIA, "bytes=5000-,900-999", BOUNDARY)
        expect(plan.status).toBe(206)
        expect(plan.contentRange).toBe("bytes 900-999/2537")
    })
})

describe("reads over the chunks a file was stored in", () => {
    it("reads inside one chunk when the stretch fits there", () => {
        const plan = planRangedResponse(MEDIA, "bytes=1000-1999", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([{ chunk: 1, offset: 0, length: 1000 }])
    })

    it("splits a stretch that crosses a chunk boundary", () => {
        const plan = planRangedResponse(MEDIA, "bytes=900-1100", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 0, offset: 900, length: 100 },
            { chunk: 1, offset: 0, length: 101 },
        ])
    })

    it("counts an offset from the start of its own chunk", () => {
        const plan = planRangedResponse(SMALL, "bytes=100-110", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([{ chunk: 1, offset: 36, length: 11 }])
    })

    it("stops at the last byte of a chunk that ends the stretch", () => {
        const plan = planRangedResponse(SMALL, "bytes=0-63", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([{ chunk: 0, offset: 0, length: 64 }])
    })

    it("walks every chunk a long stretch touches", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-2536", BOUNDARY)
        expect(plan.parts[0].reads).toHaveLength(3)
    })

    it("places a stretch on chunks of unequal size", () => {
        const plan = planRangedResponse(UNEVEN, "bytes=6-8", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 0, offset: 6, length: 1 },
            { chunk: 1, offset: 0, length: 2 },
        ])
    })

    it("crosses a chunk holding a single byte", () => {
        const plan = planRangedResponse(UNEVEN, "bytes=307-308", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 2, offset: 0, length: 1 },
            { chunk: 3, offset: 0, length: 1 },
        ])
    })

    it("reads two bytes either side of a boundary", () => {
        const plan = planRangedResponse(MEDIA, "bytes=1999-2000", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 1, offset: 999, length: 1 },
            { chunk: 2, offset: 0, length: 1 },
        ])
    })
})

describe("members folded together", () => {
    it("folds two members that overlap", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,50-199", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentRange).toBe("bytes 0-199/2537")
    })

    it("joins two members that meet end to end", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,100-199", BOUNDARY)
        expect(plan.contentRange).toBe("bytes 0-199/2537")
    })

    it("folds a member wholly inside another", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-999,300-399", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.bytesServed).toBe(1000)
    })

    it("folds a member repeated", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,0-99", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentLength).toBe(100)
        expect(plan.parts[0].reads).toEqual([{ chunk: 0, offset: 0, length: 100 }])
    })

    it("puts stretches in ascending order whatever order they arrived in", () => {
        const plan = planRangedResponse(MEDIA, "bytes=400-499,0-99", BOUNDARY)
        expect(plan.parts[0].first).toBe(0)
        expect(plan.parts[1].first).toBe(400)
    })
})

describe("a gap worth crossing", () => {
    it("keeps a gap that costs the same as the framing it saves", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,174-273", BOUNDARY)
        expect(plan.parts).toHaveLength(2)
        expect(plan.contentRange).toBeNull()
    })

    it("crosses a gap one byte under that", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,173-272", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentRange).toBe("bytes 0-272/2537")
    })

    it("serves the crossed gap as part of the stretch", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,173-272", BOUNDARY)
        expect(plan.bytesServed).toBe(273)
        expect(plan.contentLength).toBe(273)
    })

    it("crosses the same gap once the boundary grows", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,174-273", LONG_BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentRange).toBe("bytes 0-273/2537")
    })

    it("crosses the same gap once the file's type grows", () => {
        const plan = planRangedResponse(BULK, "bytes=0-99,174-273", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.bytesServed).toBe(274)
    })

    it("crosses two gaps in a row", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,173-272,346-445", BOUNDARY)
        expect(plan.parts).toHaveLength(1)
        expect(plan.contentRange).toBe("bytes 0-445/2537")
        expect(plan.bytesServed).toBe(446)
    })

    it("crosses gaps that swallow whole chunks", () => {
        const plan = planRangedResponse(SMALL, "bytes=0-9,40-49,120-129", BOUNDARY)
        expect(plan.contentLength).toBe(130)
        expect(plan.parts[0].reads).toEqual([
            { chunk: 0, offset: 0, length: 64 },
            { chunk: 1, offset: 0, length: 64 },
            { chunk: 2, offset: 0, length: 2 },
        ])
    })

    it("keeps a gap far wider than any framing", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,200-299", BOUNDARY)
        expect(plan.parts).toHaveLength(2)
        expect(plan.parts[1].first).toBe(200)
    })

    it("reads a crossed gap as one run of chunk reads", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,173-272", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([{ chunk: 0, offset: 0, length: 273 }])
    })
})

describe("several stretches in one answer", () => {
    it("names the multipart type and drops the content range", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,200-299", BOUNDARY)
        expect(plan.status).toBe(206)
        expect(plan.contentType).toBe("multipart/byteranges; boundary=cvbound")
        expect(plan.contentRange).toBeNull()
    })

    it("measures the body two stretches make", () => {
        expect(planRangedResponse(MEDIA, "bytes=0-99,200-299", BOUNDARY).contentLength).toBe(360)
    })

    it("measures the body three stretches make", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,200-299,400-499", BOUNDARY)
        expect(plan.contentLength).toBe(535)
    })

    it("measures the body four stretches make", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,200-299,400-499,600-699", BOUNDARY)
        expect(plan.contentLength).toBe(710)
    })

    it("leaves framing out of the bytes served", () => {
        expect(planRangedResponse(MEDIA, "bytes=0-99,200-299", BOUNDARY).bytesServed).toBe(200)
    })

    it("grows the body with a longer boundary", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,200-299", LONG_BOUNDARY)
        expect(plan.contentLength).toBe(390)
        expect(plan.contentType).toBe("multipart/byteranges; boundary=cloudvault-71f3c0")
    })

    it("measures a body over a smaller file", () => {
        const plan = planRangedResponse(SMALL, "bytes=10-20,100-110", BOUNDARY)
        expect(plan.contentLength).toBe(183)
        expect(plan.bytesServed).toBe(22)
    })

    it("measures a body whose stretch crosses a chunk", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,900-1100", BOUNDARY)
        expect(plan.contentLength).toBe(462)
        expect(plan.bytesServed).toBe(301)
    })

    it("splits the reads of a stretch inside a multipart answer", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,900-1100", BOUNDARY)
        expect(plan.parts[1].reads).toEqual([
            { chunk: 0, offset: 900, length: 100 },
            { chunk: 1, offset: 0, length: 101 },
        ])
    })

    it("carries two stretches out of a single chunk", () => {
        const plan = planRangedResponse(ONE, "bytes=0-9,100-109", BOUNDARY)
        expect(plan.contentLength).toBe(189)
        expect(plan.bytesServed).toBe(20)
    })

    it("gives every stretch its own reads", () => {
        const plan = planRangedResponse(SMALL, "bytes=10-20,100-110", BOUNDARY)
        expect(plan.parts[0].reads).toEqual([{ chunk: 0, offset: 10, length: 11 }])
        expect(plan.parts[1].reads).toEqual([{ chunk: 1, offset: 36, length: 11 }])
    })
})

describe("too many stretches to be worth splitting", () => {
    it("carries four stretches", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,200-299,400-499,600-699", BOUNDARY)
        expect(plan.status).toBe(206)
        expect(plan.parts).toHaveLength(4)
    })

    it("sends the whole file rather than five", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,200-299,400-499,600-699,800-899", BOUNDARY)
        expect(plan.status).toBe(200)
        expect(plan.contentLength).toBe(2537)
    })

    it("serves four stretches and nothing between them", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,200-299,400-499,600-699", BOUNDARY)
        expect(plan.bytesServed).toBe(400)
        expect(plan.parts[3].last).toBe(699)
    })

    it("keeps the file's own type when it gives up on splitting", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,200-299,400-499,600-699,800-899", BOUNDARY)
        expect(plan.contentType).toBe("video/mp4")
        expect(plan.contentRange).toBeNull()
        expect(plan.contentLength).toBe(2537)
    })

    it("counts stretches after gaps are crossed, not members", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,173-272,400-499,600-699,800-899", BOUNDARY)
        expect(plan.status).toBe(206)
        expect(plan.parts).toHaveLength(4)
        expect(plan.contentLength).toBe(884)
    })

    it("counts stretches after folding, not members", () => {
        const plan = planRangedResponse(MEDIA, "bytes=0-99,50-149,100-199,150-249,200-299,0-9", BOUNDARY)
        expect(plan.status).toBe(206)
        expect(plan.parts).toHaveLength(1)
    })

    it("sends the whole file for six separate stretches", () => {
        const plan = planRangedResponse(
            MEDIA,
            "bytes=0-99,200-299,400-499,600-699,800-899,1000-1099",
            BOUNDARY,
        )
        expect(plan.status).toBe(200)
        expect(plan.bytesServed).toBe(2537)
    })
})
