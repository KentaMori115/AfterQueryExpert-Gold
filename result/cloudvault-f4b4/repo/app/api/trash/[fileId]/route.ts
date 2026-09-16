import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { purgeFromTrash } from "@/lib/version-trash"

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    const { fileId } = await params

    try {
        const purged = await purgeFromTrash(auth.userId, fileId)
        if (!purged) {
            return NextResponse.json({ error: "Item not found in trash or access denied" }, { status: 404 })
        }
        return NextResponse.json({ success: true, message: "File permanently purged from trash" })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to purge file" }, { status: 500 })
    }
}
