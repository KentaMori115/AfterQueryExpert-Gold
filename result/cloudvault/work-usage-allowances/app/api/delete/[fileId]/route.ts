import { NextResponse } from "next/server"
import { withFirebaseAuthToken, type AuthenticatedRequest } from "@/lib/auth-middleware"
import TelegramBot from "node-telegram-bot-api"
import { deleteFileMetadataAdmin, getFileMetadataAdmin, recordUsageAdmin } from "@/lib/firestore-admin"

async function deleteFileHandler(
    req: AuthenticatedRequest,
    context: { params: Promise<{ fileId: string }> }
): Promise<NextResponse> {
    try {
        const { fileId } = await context.params
        const userId = req.user?.uid

        if (!userId || !fileId) {
            return NextResponse.json({ message: "Invalid request parameters" }, { status: 400 })
        }

        // Fetch file metadata to verify ownership
        const meta = await getFileMetadataAdmin(fileId)
        if (meta && meta.userId !== userId) {
            return NextResponse.json({ message: "Forbidden: You do not own this file" }, { status: 403 })
        }

        // Delete metadata entry from Firestore
        const deletedDoc = await deleteFileMetadataAdmin(userId, fileId)

        // Record deletion event in analytics usage
        await recordUsageAdmin(userId, meta?.apiKeyId || "dashboard", "delete", 0, true, "/api/delete")

        return NextResponse.json(
            {
                success: true,
                message: `Successfully deleted file record ${fileId}`,
                deletedFromFirestore: deletedDoc,
            },
            { status: 200 }
        )
    } catch (error: any) {
        console.error("Delete file handler error:", error)
        return NextResponse.json(
            { message: "Failed to delete file", error: error.message },
            { status: 500 }
        )
    }
}

export const DELETE = withFirebaseAuthToken(deleteFileHandler)
