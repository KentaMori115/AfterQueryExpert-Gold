import { NextResponse } from "next/server"
import { verifyShareToken } from "@/lib/share-utils"
import { getFileMetadataAdmin, recordUsageAdmin } from "@/lib/firestore-admin"
import { getUserProfile } from "@/lib/firestore"
import { buildDownloadFilename, getContentType } from "@/lib/file-utils"
import TelegramBot from "node-telegram-bot-api"

export async function GET(
    request: Request,
    context: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
    try {
        const { token } = await context.params
        if (!token) {
            return NextResponse.json({ message: "Missing token" }, { status: 400 })
        }

        // Verify the token
        const payload = verifyShareToken(token)
        if (!payload) {
            return NextResponse.json({ message: "Sharing link has expired or is invalid" }, { status: 403 })
        }

        const { fileId } = payload

        // Fetch file metadata
        const meta = await getFileMetadataAdmin(fileId)
        if (!meta) {
            return NextResponse.json({ message: "File metadata not found" }, { status: 404 })
        }

        // Lookup file owner profile to get their Telegram configuration
        const userProfile = await getUserProfile(meta.userId)
        if (!userProfile || !userProfile.botToken) {
            return NextResponse.json({ message: "File owner configuration not found" }, { status: 404 })
        }

        const bot = new TelegramBot(userProfile.botToken)
        const filenameWithExt = buildDownloadFilename(meta.originalFilename, meta.extension)
        const contentType = getContentType(meta.extension || "")

        // Chunked streaming reassembly
        if (meta.chunks && meta.chunks.length > 0) {
            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        for (let i = 0; i < meta.chunks!.length; i++) {
                            const path = meta.chunkPaths![i]
                            const chunkUrl = `https://api.telegram.org/file/bot${userProfile.botToken}/${path}`
                            const res = await fetch(chunkUrl)
                            if (!res.ok) {
                                controller.error(new Error(`Failed to fetch chunk part ${i + 1}`))
                                return
                            }
                            const reader = res.body?.getReader()
                            if (reader) {
                                while (true) {
                                    const { done, value } = await reader.read()
                                    if (done) break
                                    controller.enqueue(value)
                                }
                            }
                        }
                        controller.close()
                    } catch (e: any) {
                        controller.error(e)
                    }
                }
            })

            await recordUsageAdmin(meta.userId, meta.apiKeyId, "download", meta.size, true, "/api/share")

            return new NextResponse(stream, {
                status: 200,
                headers: {
                    "Content-Type": contentType,
                    "Content-Disposition": `attachment; filename="${filenameWithExt}"`,
                    "Content-Length": meta.size.toString(),
                    "X-CloudVault-Chunked": "1",
                },
            })
        }

        // Normal single file download
        const telegramDirectUrl = `https://api.telegram.org/file/bot${userProfile.botToken}/${meta.filePath}`
        let tgResp = await fetch(telegramDirectUrl)

        // If the path is stale, try to re-resolve it once
        if (tgResp.status === 404) {
            try {
                const latest = await bot.getFile(fileId)
                if (latest.file_path && latest.file_path !== meta.filePath) {
                    const newDirectUrl = `https://api.telegram.org/file/bot${userProfile.botToken}/${latest.file_path}`
                    tgResp = await fetch(newDirectUrl)
                }
            } catch (err) {
                console.warn("Could not auto-resolve stale path in public share route:", err)
            }
        }

        if (!tgResp.ok) {
            return NextResponse.json({ message: `Telegram download failed with status ${tgResp.status}` }, { status: 502 })
        }

        const blobArrayBuffer = await tgResp.arrayBuffer()
        const bytes = Buffer.from(blobArrayBuffer)

        // Record usage under owner
        await recordUsageAdmin(meta.userId, meta.apiKeyId, "download", meta.size, true, "/api/share")

        return new NextResponse(bytes, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${filenameWithExt}"`,
                "Content-Length": bytes.length.toString(),
            },
        })
    } catch (error: any) {
        console.error("Public share download error:", error)
        return NextResponse.json({ message: "Something went wrong", error: error.message }, { status: 500 })
    }
}
