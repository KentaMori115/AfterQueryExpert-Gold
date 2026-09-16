import { NextResponse } from "next/server"
import { withFirebaseAuthToken, type AuthenticatedRequest } from "@/lib/auth-middleware"
import { getUserAnalyticsAdmin } from "@/lib/firestore-admin"

async function getAnalyticsHandler(req: AuthenticatedRequest): Promise<NextResponse> {
    try {
        const userId = req.user?.uid
        if (!userId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const days = parseInt(searchParams.get("days") || "7", 10)

        const analytics = await getUserAnalyticsAdmin(userId, days)

        return NextResponse.json(
            {
                success: true,
                data: analytics,
            },
            { status: 200 }
        )
    } catch (error: any) {
        console.error("Analytics error:", error)
        return NextResponse.json(
            { message: "Failed to load analytics", error: error.message },
            { status: 500 }
        )
    }
}

export const GET = withFirebaseAuthToken(getAnalyticsHandler)
