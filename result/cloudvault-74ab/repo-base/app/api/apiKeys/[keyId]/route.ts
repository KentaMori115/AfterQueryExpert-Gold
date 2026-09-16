import { NextResponse } from "next/server"
import { withFirebaseAuthToken, type AuthenticatedRequest } from "@/lib/auth-middleware"
import { deactivateApiKeyAdmin } from "@/lib/firestore-admin"

async function deactivateApiKeyHandler(
    req: AuthenticatedRequest,
    { params }: { params: { keyId: string } },
): Promise<NextResponse> {
    try {
        const keyId = params.keyId

        await deactivateApiKeyAdmin(keyId)

        return NextResponse.json({
            success: true,
            message: "API key deactivated successfully",
        })
    } catch (error) {
        console.error("Deactivate API key error:", error)
        return NextResponse.json({ message: "Failed to deactivate API key" }, { status: 500 })
    }
}

export const DELETE = withFirebaseAuthToken(deactivateApiKeyHandler)
