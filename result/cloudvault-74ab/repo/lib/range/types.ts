// Shapes shared by the ranged download planner.
//
// A stored file is a list of Telegram chunks. Nothing here knows how a chunk is
// fetched; the planner only decides which stretch of which chunk has to be read
// and what the response headers say about it.

// What the planner is told about a stored file.
export interface ChunkManifest {
    // Byte length of every chunk, in the order the chunks were uploaded.
    chunkSizes: number[]
    // Content type the whole file is served as.
    contentType: string
}

// One contiguous read inside a single chunk.
export interface ChunkRead {
    // Index into ChunkManifest.chunkSizes.
    chunk: number
    // First byte to read, counted from the start of that chunk.
    offset: number
    // How many bytes to read.
    length: number
}

// One stretch of the file that the response carries.
export interface RangePart {
    // First and last byte of the stretch, counted from the start of the file.
    first: number
    last: number
    // The reads that cover the stretch, in ascending order.
    reads: ChunkRead[]
}

// Everything the download route needs to answer one request.
export interface RangePlan {
    // 200 for the whole file, 206 for a partial answer, 416 when nothing asked
    // for exists.
    status: number
    // Value of the response Content-Type header.
    contentType: string
    // Value of the response Content-Range header, or null when the response
    // carries no such header.
    contentRange: string | null
    // Value of the response Content-Length header.
    contentLength: number
    // The stretches carried, in ascending order.
    parts: RangePart[]
    // File bytes read to answer the request, framing excluded.
    bytesServed: number
}

// A range asked for, before it is measured against the file.
export interface RangeSpec {
    // Absent first means a suffix range, absent last means "to the end".
    first: number | null
    last: number | null
}
