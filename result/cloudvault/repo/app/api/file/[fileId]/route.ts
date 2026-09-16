import { NextResponse } from "next/server"
import { withFirebaseAuth, type AuthenticatedRequest } from "@/lib/auth-middleware"
import { applyRateLimit } from "@/lib/rate-limit"
import { buildDownloadFilename, formatSizeMB, getContentType, getExtension } from "@/lib/file-utils"
import TelegramBot from "node-telegram-bot-api"
import { getFileMetadataAdmin, recordUsageAdmin, saveFileMetadataAdmin } from "@/lib/firestore-admin"

async function getFileHandler(
    req: AuthenticatedRequest,
    context: { params: Promise<{ fileId: string }> },
): Promise<NextResponse> {
    try {
        const rateLimitResult = await applyRateLimit(req)
        if (rateLimitResult.limited) {
            return NextResponse.json(
                { message: "Too many requests" },
                {
                    status: 429,
                    headers: {
                        "Retry-After": (rateLimitResult.retryAfter ?? 60).toString(),
                    },
                },
            )
        }

        const { fileId } = await context.params
        const { botToken } = req.userConfig!
        const bot = new TelegramBot(botToken)

        // Look up stored metadata
        let meta = await getFileMetadataAdmin(fileId)
        if (!meta) {
            try {
                const info = await bot.getFile(fileId)
                const tfPath = info.file_path || ''
                const sizeFromInfo = info.file_size || 0
                const parts = tfPath.split('/')
                const rawName = parts[parts.length - 1] || fileId
                const ext = getExtension(rawName)
                const originalName = rawName
                await saveFileMetadataAdmin({
                    userId: req.user!.uid,
                    apiKeyId: req.apiKeyData!.id,
                    fileId,
                    filePath: tfPath,
                    originalFilename: originalName,
                    extension: ext,
                    size: sizeFromInfo,
                })
                meta = {
                    userId: req.user!.uid,
                    apiKeyId: req.apiKeyData!.id,
                    fileId,
                    filePath: tfPath,
                    originalFilename: originalName,
                    extension: ext,
                    size: sizeFromInfo,
                    createdAt: new Date(),
                }
            } catch (tgErr) {
                console.error("Telegram fallback getFile failed:", tgErr)
                return NextResponse.json({ message: "File metadata not found and Telegram lookup failed" }, { status: 404 })
            }
        }

        let fileSize = meta.size || 0
        let pathUpdated = false
        if (!meta.chunks) {
            try {
                const info = await bot.getFile(fileId)
                fileSize = info.file_size || meta.size || 0
                const latestPath = info.file_path
                if (latestPath && latestPath !== meta.filePath) {
                    await saveFileMetadataAdmin({
                        userId: meta.userId,
                        apiKeyId: meta.apiKeyId,
                        fileId: meta.fileId,
                        filePath: latestPath,
                        originalFilename: meta.originalFilename,
                        extension: meta.extension,
                        size: fileSize,
                    })
                    meta.filePath = latestPath
                    meta.size = fileSize
                    pathUpdated = true
                }
            } catch (e) {
                console.warn("Could not refetch Telegram file info, using stored size.")
                fileSize = meta.size || 0
            }
        }

        const url = new URL(req.url)
        const shouldRefresh = url.searchParams.get("refresh") === "1"

        if (shouldRefresh && !meta.chunks) {
            try {
                const latest = await bot.getFile(fileId)
                const latestPath = latest.file_path
                if (latestPath && latestPath !== meta.filePath) {
                    await saveFileMetadataAdmin({
                        userId: meta.userId,
                        apiKeyId: meta.apiKeyId,
                        fileId: meta.fileId,
                        filePath: latestPath,
                        originalFilename: meta.originalFilename,
                        extension: meta.extension,
                        size: latest.file_size || meta.size || 0,
                    })
                    meta.filePath = latestPath
                    meta.size = latest.file_size || meta.size
                }
            } catch (e) {
                console.warn("Refresh requested but getFile failed:", e)
            }
        }

        const shouldDownload = url.searchParams.get("download") === "1"
        const telegramDirectUrl = `https://api.telegram.org/file/bot${botToken}/${meta.filePath}`

        if (shouldDownload) {
            try {
                const filenameWithExt = buildDownloadFilename(meta.originalFilename, meta.extension)
                const contentType = getContentType(meta.extension || "")

                // Chunked reassembly stream
                if (meta.chunks && meta.chunks.length > 0) {
                    const stream = new ReadableStream({
                        async start(controller) {
                            try {
                                for (let i = 0; i < meta.chunks!.length; i++) {
                                    const path = meta.chunkPaths![i]
                                    const chunkUrl = `https://api.telegram.org/file/bot${botToken}/${path}`
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

                    await recordUsageAdmin(req.user!.uid, req.apiKeyData!.id, "download", meta.size, true, "/api/file")

                    return new NextResponse(stream, {
                        status: 200,
                        headers: {
                            'Content-Type': contentType,
                            'Content-Disposition': `attachment; filename="${filenameWithExt}"`,
                            'Content-Length': meta.size.toString(),
                            'X-Telegram-Path-Updated': pathUpdated ? '1' : '0',
                            'X-CloudVault-Chunked': '1',
                        },
                    })
                }

                // Normal Download proxy
                let activeDirectUrl = telegramDirectUrl
                let tgResp = await fetch(activeDirectUrl)

                if (tgResp.status === 404) {
                    try {
                        const latest = await bot.getFile(fileId)
                        if (latest.file_path && latest.file_path !== meta.filePath) {
                            await saveFileMetadataAdmin({
                                userId: meta.userId,
                                apiKeyId: meta.apiKeyId,
                                fileId: meta.fileId,
                                filePath: latest.file_path,
                                originalFilename: meta.originalFilename,
                                extension: meta.extension,
                                size: latest.file_size || fileSize,
                            })
                            meta.filePath = latest.file_path
                            meta.size = latest.file_size || fileSize
                            activeDirectUrl = `https://api.telegram.org/file/bot${botToken}/${meta.filePath}`
                            pathUpdated = true
                            tgResp = await fetch(activeDirectUrl)
                        }
                    } catch (refreshErr) {
                        console.warn("Automatic path refresh failed:", refreshErr)
                    }
                }

                if (!tgResp.ok) {
                    throw new Error(`Telegram fetch failed: ${tgResp.status}`)
                }
                const blobArrayBuffer = await tgResp.arrayBuffer()
                const bytes = Buffer.from(blobArrayBuffer)

                await recordUsageAdmin(req.user!.uid, req.apiKeyData!.id, "download", fileSize, true, "/api/file")

                return new NextResponse(bytes, {
                    status: 200,
                    headers: {
                        'Content-Type': contentType,
                        'Content-Disposition': `attachment; filename="${filenameWithExt}"`,
                        'Content-Length': bytes.length.toString(),
                        'X-Telegram-Path-Updated': pathUpdated ? '1' : '0',
                    },
                })
            } catch (error: any) {
                console.error("Download proxy error:", error)
                await recordUsageAdmin(req.user!.uid, req.apiKeyData!.id, "download", 0, false, "/api/file")
                return NextResponse.json({ message: "Failed to proxy file", error: error.message }, { status: 500 })
            }
        }

        await recordUsageAdmin(req.user!.uid, req.apiKeyData!.id, "download", fileSize, true, "/api/file")
        return NextResponse.json(
            {
                success: true,
                data: {
                    fileId,
                    telegramFilePath: meta.filePath,
                    originalFilename: meta.originalFilename,
                    extension: meta.extension,
                    fileSize,
                    fileSizeFormatted: formatSizeMB(fileSize),
                    directUrl: telegramDirectUrl,
                    internalDownloadUrl: `${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/file/${fileId}?download=1`,
                    accessedAt: new Date().toISOString(),
                    apiKeyUsed: req.apiKeyData!.name,
                    pathUpdated,
                    isChunked: !!meta.chunks,
                    chunksCount: meta.chunks ? meta.chunks.length : 0,
                },
            },
            { status: 200 },
        )

    } catch (error) {
        console.error("Get file error:", error)
        return NextResponse.json({ message: "Something went wrong" }, { status: 500 })
    }
}

export const GET = withFirebaseAuth(getFileHandler)
