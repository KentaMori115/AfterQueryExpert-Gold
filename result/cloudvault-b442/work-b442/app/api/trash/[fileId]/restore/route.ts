import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { restoreFromTrash } from "@/lib/version-trash"

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    const { fileId } = await params

    try {
        const restored = await restoreFromTrash(auth.userId, fileId)
        if (!restored) {
            return NextResponse.json({ error: "Item not found in trash or access denied" }, { status: 404 })
        }
        return NextResponse.json({ success: true, message: "File restored successfully" })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to restore file" }, { status: 500 })
    }
}
