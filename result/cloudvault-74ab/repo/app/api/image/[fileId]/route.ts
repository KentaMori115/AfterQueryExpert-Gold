import { NextRequest, NextResponse } from "next/server"
import { getFileMetadataAdmin } from "@/lib/firestore-admin"
import { transformImageBuffer } from "@/lib/image-processor"

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const { fileId } = await params
    const { searchParams } = req.nextUrl

    const width = searchParams.get("w") || searchParams.get("width")
    const height = searchParams.get("h") || searchParams.get("height")
    const fit = (searchParams.get("fit") as any) || "cover"
    const format = (searchParams.get("fmt") || searchParams.get("format") as any) || "webp"
    const quality = searchParams.get("q") || searchParams.get("quality")
    const blur = searchParams.get("blur")
    const grayscale = searchParams.get("grayscale") === "1" || searchParams.get("grayscale") === "true"

    try {
        const meta = await getFileMetadataAdmin(fileId)
        if (!meta) {
            return NextResponse.json({ error: "Image file metadata not found" }, { status: 404 })
        }

        // Fetch original file bytes from internal stream/download route
        const host = req.nextUrl.origin
        const fileRes = await fetch(`${host}/api/file/${fileId}?download=1`, {
            headers: {
                Authorization: req.headers.get("Authorization") || "",
            },
        })

        if (!fileRes.ok) {
            return NextResponse.json({ error: "Failed to retrieve source image bytes" }, { status: fileRes.status })
        }

        const arrayBuffer = await fileRes.arrayBuffer()
        const inputBuffer = Buffer.from(arrayBuffer)

        const { buffer: transformedBuffer, contentType } = await transformImageBuffer(inputBuffer, {
            width: width ? Number(width) : undefined,
            height: height ? Number(height) : undefined,
            fit,
            format,
            quality: quality ? Number(quality) : undefined,
            blur: blur ? Number(blur) : undefined,
            grayscale,
        })

        return new NextResponse(transformedBuffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to transform image" }, { status: 500 })
    }
}
