import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { createShareLink, getUserShareLinks } from "@/lib/share-manager"

export async function GET(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const shares = await getUserShareLinks(auth.userId)
        return NextResponse.json({ shares })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to fetch share links" }, { status: 500 })
    }
}

export async function POST(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const body = await req.json()
        const { fileId, password, maxDownloads, expiresInHours } = body

        if (!fileId) {
            return NextResponse.json({ error: "fileId is required" }, { status: 400 })
        }

        const share = await createShareLink(auth.userId, fileId, {
            password,
            maxDownloads: maxDownloads ? Number(maxDownloads) : undefined,
            expiresInHours: expiresInHours ? Number(expiresInHours) : undefined,
        })

        return NextResponse.json({ share }, { status: 201 })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to create share link" }, { status: 500 })
    }
}
