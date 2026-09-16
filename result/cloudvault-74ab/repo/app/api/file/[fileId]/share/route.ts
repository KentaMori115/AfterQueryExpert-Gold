import { NextResponse } from "next/server"
import { withFirebaseAuthToken, type AuthenticatedRequest } from "@/lib/auth-middleware"
import { getFileMetadataAdmin } from "@/lib/firestore-admin"
import { generateShareToken } from "@/lib/share-utils"

async function generateShareLinkHandler(
    req: AuthenticatedRequest,
    context: { params: Promise<{ fileId: string }> }
): Promise<NextResponse> {
    try {
        const { fileId } = await context.params
        const userId = req.user?.uid

        if (!userId || !fileId) {
            return NextResponse.json({ message: "Invalid request parameters" }, { status: 400 })
        }

        // Verify user owns the file
        const meta = await getFileMetadataAdmin(fileId)
        if (!meta) {
            return NextResponse.json({ message: "File not found" }, { status: 404 })
        }

        if (meta.userId !== userId) {
            return NextResponse.json({ message: "Forbidden: Ownership check failed" }, { status: 403 })
        }

        // Parse TTL (time-to-live) in seconds
        let ttl = 3600 // Default 1 hour
        try {
            const body = await req.json()
            if (body.ttl && typeof body.ttl === "number") {
                ttl = body.ttl
            }
        } catch (e) {
            // No body provided, use default
        }

        // Generate token
        const token = generateShareToken(fileId, ttl)
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ""
        const shareUrl = `${baseUrl}/api/share/${token}`

        return NextResponse.json(
            {
                success: true,
                token,
                shareUrl,
                expiresInSeconds: ttl,
                expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
            },
            { status: 200 }
        )
    } catch (error: any) {
        console.error("Generate share link error:", error)
        return NextResponse.json(
            { message: "Failed to generate share link", error: error.message },
            { status: 500 }
        )
    }
}

export const POST = withFirebaseAuthToken(generateShareLinkHandler)
