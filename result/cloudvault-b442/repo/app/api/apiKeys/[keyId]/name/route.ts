import { NextResponse } from "next/server"
import { withFirebaseAuthToken, type AuthenticatedRequest } from "@/lib/auth-middleware"
import { getFirestore } from "firebase-admin/firestore"

async function updateApiKeyNameHandler(
    req: AuthenticatedRequest,
    context: { params: Promise<{ keyId: string }> }, // Update type to indicate params is a Promise
): Promise<NextResponse> {
    try {
        const { keyId } = await context.params // Await params before accessing keyId
        const { name } = await req.json()

        if (!name || typeof name !== "string" || name.trim() === "") {
            return NextResponse.json({ message: "Invalid API key name" }, { status: 400 })
        }

        const adminDb = getFirestore()
        const apiKeyRef = adminDb.collection("apiKeys").doc(keyId)
        const apiKeyDoc = await apiKeyRef.get()

        if (!apiKeyDoc.exists) {
            return NextResponse.json({ message: "API key not found" }, { status: 404 })
        }

        const apiKeyData = apiKeyDoc.data()
        if (apiKeyData?.userId !== req.user?.uid) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 403 })
        }

        await apiKeyRef.update({
            name: name.trim(),
            updatedAt: new Date(),
        })

        return NextResponse.json({
            success: true,
            message: "API key name updated successfully",
        })
    } catch (error) {
        console.error("Error updating API key name:", error)
        return NextResponse.json({ message: "Failed to update API key name" }, { status: 500 })
    }
}

export const PUT = withFirebaseAuthToken(updateApiKeyNameHandler)
