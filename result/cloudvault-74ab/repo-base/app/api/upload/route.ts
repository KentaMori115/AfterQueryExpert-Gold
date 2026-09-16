import { NextResponse } from "next/server"
import { withFirebaseAuth, type AuthenticatedRequest } from "@/lib/auth-middleware"
import { applyRateLimit } from "@/lib/rate-limit"
import { recordUsageAdmin, saveFileMetadataAdmin } from "@/lib/firestore-admin"
import { MAX_FILE_SIZE, formatSizeMB, getExtension, stripExtension } from "@/lib/file-utils"
import TelegramBot from "node-telegram-bot-api"

async function uploadHandler(req: AuthenticatedRequest): Promise<NextResponse> {
    try {
        // Apply rate limiting
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

        const formData = await req.formData()
        const file = formData.get("file") as File | null

        if (!file) {
            await recordUsageAdmin(req.user!.uid, req.apiKeyData!.id, "upload", 0, false, "/api/upload")
            return NextResponse.json({ message: "No file uploaded" }, { status: 400 })
        }

        if (file.size > MAX_FILE_SIZE) {
            await recordUsageAdmin(req.user!.uid, req.apiKeyData!.id, "upload", file.size, false, "/api/upload")
            return NextResponse.json({ message: "File size exceeds the limit of 250MB" }, { status: 413 })
        }

        const { botToken, chatId } = req.userConfig!
        const bot = new TelegramBot(botToken)

        // Convert file to buffer
        const buffer = Buffer.from(await file.arrayBuffer())
        const CHUNK_SIZE = 45 * 1024 * 1024 // 45MB chunks

        let fileId: string | null = null
        let filePath: string | null = null
        let messageId: number | null = null
        const chunks: string[] = []
        const chunkPaths: string[] = []

        if (file.size <= CHUNK_SIZE) {
            // Normal Single Upload
            let telegramResponse = await bot.sendDocument(
                chatId,
                buffer,
                {
                    caption: `📁 File uploaded via CloudVault API\n📝 Filename: ${file.name}\n📊 Size: ${formatSizeMB(file.size)}\n🔑 API Key: ${req.apiKeyData!.name}\n⏳ Processing file ID and URL...`,
                },
                { filename: file.name }
            )
            messageId = telegramResponse?.message_id || null
            if (telegramResponse?.document?.file_id) {
                fileId = telegramResponse.document.file_id
            } else if (telegramResponse?.photo && telegramResponse.photo.length > 0) {
                fileId = telegramResponse.photo[telegramResponse.photo.length - 1].file_id
            } else if (telegramResponse?.video?.file_id) {
                fileId = telegramResponse.video.file_id
            } else if (telegramResponse?.audio?.file_id) {
                fileId = telegramResponse.audio.file_id
            }

            if (fileId) {
                const tf = await bot.getFile(fileId)
                filePath = tf.file_path || null
            }
        } else {
            // Chunked Multi-Upload for large files (> 45MB)
            const chunksCount = Math.ceil(file.size / CHUNK_SIZE)
            console.log(`Starting chunked upload of ${file.name} in ${chunksCount} chunks...`)

            for (let i = 0; i < chunksCount; i++) {
                const start = i * CHUNK_SIZE
                const end = Math.min(start + CHUNK_SIZE, file.size)
                const chunkBuffer = buffer.subarray(start, end)

                const chunkFilename = `${file.name}.part${i + 1}_of_${chunksCount}`
                const chunkResponse = await bot.sendDocument(
                    chatId,
                    chunkBuffer,
                    {
                        caption: `📁 Part ${i + 1}/${chunksCount} of ${file.name}\n📊 Size: ${formatSizeMB(chunkBuffer.length)}\n🔑 API Key: ${req.apiKeyData!.name}`,
                    },
                    { filename: chunkFilename }
                )

                const chunkFileId = chunkResponse?.document?.file_id
                if (!chunkFileId) {
                    throw new Error(`Failed to upload chunk part ${i + 1} of ${chunksCount}`)
                }

                const tf = await bot.getFile(chunkFileId)
                chunks.push(chunkFileId)
                chunkPaths.push(tf.file_path || "")

                if (i === 0) {
                    fileId = chunkFileId
                    filePath = tf.file_path || null
                    messageId = chunkResponse?.message_id || null
                }
            }
        }

        if (!fileId || !filePath) {
            throw new Error("Telegram failed to return document identifiers")
        }

        const originalName = file.name
        const extension = getExtension(originalName)

        // Save canonical file metadata mapping
        await saveFileMetadataAdmin({
            userId: req.user!.uid,
            apiKeyId: req.apiKeyData!.id,
            fileId,
            filePath,
            originalFilename: originalName,
            extension,
            size: file.size,
            chunks: chunks.length > 0 ? chunks : undefined,
            chunkPaths: chunkPaths.length > 0 ? chunkPaths : undefined,
        })

        const base = process.env.NEXT_PUBLIC_BASE_URL || ""
        const fileUrl = `${base}/api/file/${fileId}`
        const telegramDirectUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`
        const telegramFilePathNoExt = stripExtension(filePath)

        if (messageId && fileId && filePath) {
            try {
                await bot.editMessageCaption(
                    `📁 File uploaded via CloudVault API\n📝 Filename: ${file.name}\n📊 Size: ${formatSizeMB(file.size)}\n🔑 API Key: ${req.apiKeyData!.name}\n🆔 File ID: ${fileId}\n🗃️ Telegram Path: ${filePath}${chunks.length > 0 ? `\n🧱 Parts: ${chunks.length} chunks` : ""}`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                    },
                )
            } catch (editError) {
                console.error("Error editing Telegram message:", editError)
            }
        }

        await recordUsageAdmin(req.user!.uid, req.apiKeyData!.id, "upload", file.size, true, "/api/upload")

        return NextResponse.json(
            {
                success: true,
                message: chunks.length > 0 ? "Large file uploaded in chunks successfully!" : "File uploaded successfully!",
                data: {
                    filename: file.name,
                    fileId: fileId,
                    fileUrl: fileUrl,
                    telegramDirectUrl: telegramDirectUrl,
                    telegramFilePath: filePath,
                    telegramFilePathNoExt: telegramFilePathNoExt,
                    extension,
                    size: file.size,
                    sizeFormatted: formatSizeMB(file.size),
                    telegramMessageId: messageId,
                    uploadedAt: new Date().toISOString(),
                    apiKeyUsed: req.apiKeyData!.name,
                    isChunked: chunks.length > 0,
                    chunksCount: chunks.length,
                },
            },
            { status: 200 },
        )
    } catch (error) {
        console.error("Upload error:", error)
        if (req.apiKeyData) {
            await recordUsageAdmin(req.user!.uid, req.apiKeyData.id, "upload", 0, false, "/api/upload")
        }
        return NextResponse.json(
            { message: "Something went wrong", error: error instanceof Error ? error.message : "Unknown error" },
            { status: 500 },
        )
    }
}

export const POST = withFirebaseAuth(uploadHandler)
