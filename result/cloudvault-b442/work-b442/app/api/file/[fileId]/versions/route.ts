import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { getFileVersions } from "@/lib/version-trash"

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    const { fileId } = await params

    try {
        const versions = await getFileVersions(auth.userId, fileId)
        return NextResponse.json({ versions })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to fetch file versions" }, { status: 500 })
    }
}
