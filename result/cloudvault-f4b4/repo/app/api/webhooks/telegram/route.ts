import { NextResponse } from "next/server"
import TelegramBot from "node-telegram-bot-api"
import { getUserByChatIdAdmin, saveFileMetadataAdmin, getUserFilesAdmin, deleteFileMetadataAdmin } from "@/lib/firestore-admin"
import { getExtension } from "@/lib/file-utils"

export async function POST(request: Request): Promise<NextResponse> {
    try {
        const { searchParams } = new URL(request.url)
        const secret = searchParams.get("secret")
        const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET

        if (!expectedSecret) {
            return NextResponse.json({ message: "Webhook not configured" }, { status: 503 })
        }

        if (secret !== expectedSecret) {
            return NextResponse.json({ message: "Forbidden: Invalid webhook secret" }, { status: 403 })
        }

        const body = await request.json()
        if (!body || !body.message) {
            // Return 200 to acknowledge receipt of non-message updates
            return NextResponse.json({ success: true, message: "No message in update payload" })
        }

        const message = body.message
        const chatId = message.chat?.id?.toString()
        if (!chatId) {
            return NextResponse.json({ success: true, message: "No chatId found" })
        }

        // Lookup matching user profile
        const userProfile = await getUserByChatIdAdmin(chatId)
        if (!userProfile) {
            // Unregistered user interacting with the bot
            const publicBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || "")
            try {
                await publicBot.sendMessage(
                    chatId,
                    "⚠️ **Unauthorized Chat ID**\n\nYour chat ID is not registered on CloudVault. Please sign up on our website and configure this bot under your profile to use direct uploads."
                )
            } catch (err) {
                console.error("Failed to notify unregistered user:", err)
            }
            return NextResponse.json({ success: true, message: "Chat ID not registered" })
        }

        const userBot = new TelegramBot(userProfile.botToken)
        const text = message.text || ""

        // Handle commands
        if (text.startsWith("/")) {
            const command = text.split(" ")[0].toLowerCase()

            if (command === "/start") {
                await userBot.sendMessage(
                    chatId,
                    "👋 **Welcome to CloudVault Storage Bot!**\n\nSend or forward any document, photo, video, or audio file directly to this chat, and I will host it securely and return a stable developer API link!"
                )
                return NextResponse.json({ success: true })
            }

            if (command === "/list") {
                const result = await getUserFilesAdmin(userProfile.uid, { limit: 5 })
                if (result.files.length === 0) {
                    await userBot.sendMessage(chatId, "📭 You haven't uploaded any files yet.")
                } else {
                    const listStr = result.files
                        .map(
                            (f, idx) =>
                                `${idx + 1}. 📄 **${f.originalFilename}**\n   🆔 \`${f.fileId}\`\n   🔗 ${process.env.NEXT_PUBLIC_BASE_URL}/api/file/${f.fileId}?download=1`
                        )
                        .join("\n\n")

                    await userBot.sendMessage(
                        chatId,
                        `📂 **Your Recent Uploads (Last 5)**\n\n${listStr}\n\nUse \`/delete <fileId>\` to remove any file.`
                    )
                }
                return NextResponse.json({ success: true })
            }

            if (command === "/delete") {
                const fileId = text.split(" ")[1]
                if (!fileId) {
                    await userBot.sendMessage(chatId, "⚠️ Please specify a file ID: `/delete <fileId>`")
                    return NextResponse.json({ success: true })
                }

                const deleted = await deleteFileMetadataAdmin(userProfile.uid, fileId)
                if (deleted) {
                    await userBot.sendMessage(chatId, `✅ Successfully deleted file metadata for ID: \`${fileId}\``)
                } else {
                    await userBot.sendMessage(chatId, `❌ Could not delete file: ID \`${fileId}\` not found or not owned by you.`)
                }
                return NextResponse.json({ success: true })
            }
        }

        // Handle incoming files
        let fileId: string | null = null
        let originalFilename = "file"
        let size = 0

        if (message.document) {
            fileId = message.document.file_id
            originalFilename = message.document.file_name || "document"
            size = message.document.file_size || 0
        } else if (message.photo && message.photo.length > 0) {
            const photo = message.photo[message.photo.length - 1]
            fileId = photo.file_id
            originalFilename = `photo_${Date.now()}.jpg`
            size = photo.file_size || 0
        } else if (message.video) {
            fileId = message.video.file_id
            originalFilename = message.video.file_name || `video_${Date.now()}.mp4`
            size = message.video.file_size || 0
        } else if (message.audio) {
            fileId = message.audio.file_id
            originalFilename = message.audio.file_name || `audio_${Date.now()}.mp3`
            size = message.audio.file_size || 0
        }

        if (fileId) {
            try {
                // Fetch direct file path from Telegram
                const info = await userBot.getFile(fileId)
                const filePath = info.file_path || ""
                const extension = getExtension(originalFilename)

                // Save metadata record
                await saveFileMetadataAdmin({
                    userId: userProfile.uid,
                    apiKeyId: "telegram_bot",
                    fileId,
                    filePath,
                    originalFilename,
                    extension,
                    size,
                })

                const downloadUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/file/${fileId}?download=1`

                await userBot.sendMessage(
                    chatId,
                    `📂 **CloudVault In-Chat Upload Completed!**\n\n📄 **Filename**: \`${originalFilename}\`\n📊 **Size**: ${(size / (1024 * 1024)).toFixed(2)} MB\n🆔 **File ID**: \`${fileId}\`\n\n🔗 **Stable Download Link**:\n${downloadUrl}`
                )
            } catch (err: any) {
                console.error("Bot upload registration error:", err)
                await userBot.sendMessage(chatId, `❌ Failed to index file: ${err.message}`)
            }
        }

        return NextResponse.json({ success: true })
    } catch (e: any) {
        console.error("Telegram webhook error:", e)
        return NextResponse.json({ success: false, error: e.message }, { status: 500 })
    }
}
