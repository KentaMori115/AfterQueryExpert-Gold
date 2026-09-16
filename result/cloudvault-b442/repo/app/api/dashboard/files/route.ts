import { NextResponse } from "next/server"
import { withFirebaseAuthToken, type AuthenticatedRequest } from "@/lib/auth-middleware"
import { getUserFilesAdmin } from "@/lib/firestore-admin"

async function getDashboardFilesHandler(
    req: AuthenticatedRequest
): Promise<NextResponse> {
    try {
        const userId = req.user?.uid
        if (!userId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const search = searchParams.get("search") || searchParams.get("q") || ""
        const type = searchParams.get("type") || "all"
        const page = parseInt(searchParams.get("page") || "1", 10)
        const limit = parseInt(searchParams.get("limit") || "10", 10)

        const result = await getUserFilesAdmin(userId, {
            search,
            type,
            page,
            limit,
        })

        return NextResponse.json(
            {
                success: true,
                data: result.files,
                pagination: {
                    total: result.total,
                    page: result.page,
                    totalPages: result.totalPages,
                    limit,
                },
            },
            { status: 200 }
        )
    } catch (error: any) {
        console.error("Dashboard files error:", error)
        return NextResponse.json(
            { message: "Failed to fetch files", error: error.message },
            { status: 500 }
        )
    }
}

export const GET = withFirebaseAuthToken(getDashboardFilesHandler)
