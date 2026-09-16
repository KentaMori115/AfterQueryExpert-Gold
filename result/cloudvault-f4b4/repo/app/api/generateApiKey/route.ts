import { NextResponse } from "next/server"
import { withFirebaseAuthToken, type AuthenticatedRequest } from "@/lib/auth-middleware"
import { saveUserProfileAdmin, createApiKeyAdmin } from "@/lib/firestore-admin"
import { generateApiKey } from "@/lib/utils"

async function generateApiKeyHandler(req: AuthenticatedRequest): Promise<NextResponse> {
    try {
        const body = await req.json()
        const { botToken, chatId, keyName } = body

        if (!botToken || !chatId) {
            return NextResponse.json({ message: "Bot token and chat ID are required" }, { status: 400 })
        }

        const userId = req.user!.uid
        const apiKey = generateApiKey()
        const name = keyName || "Default API Key"

        // Save user profile
        await saveUserProfileAdmin(userId, req.user!.email || "", botToken, chatId)

        // Create API key
        const apiKeyData = await createApiKeyAdmin(userId, apiKey, name)

        return NextResponse.json(
            {
                success: true,
                message: "API key generated successfully",
                data: {
                    apiKey: apiKey,
                    keyName: name,
                    keyId: apiKeyData.id,
                    createdAt: apiKeyData.createdAt,
                },
            },
            { status: 201 },
        )
    } catch (error) {
        console.error("Generate API key error:", error)
        return NextResponse.json({ message: "Failed to generate API key" }, { status: 500 })
    }
}

export const POST = withFirebaseAuthToken(generateApiKeyHandler)
