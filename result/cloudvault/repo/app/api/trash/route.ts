import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { getUserTrash } from "@/lib/version-trash"

export async function GET(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const trashItems = await getUserTrash(auth.userId)
        return NextResponse.json({ trash: trashItems })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to fetch trash items" }, { status: 500 })
    }
}
