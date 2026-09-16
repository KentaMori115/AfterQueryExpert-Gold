import { NextResponse } from "next/server"
import { withFirebaseAuthToken, type AuthenticatedRequest } from "@/lib/auth-middleware"
import { getUserApiKeys } from "@/lib/firestore"
import { createApiKeyAdmin } from "@/lib/firestore-admin"
import { generateApiKey } from "@/lib/utils"

// Get all API keys for user
async function getApiKeysHandler(req: AuthenticatedRequest): Promise<NextResponse> {
    try {
        const userId = req.user!.uid
        const apiKeys = await getUserApiKeys(userId)

        return NextResponse.json({
            success: true,
            data: apiKeys.map((key) => ({
                id: key.id,
                name: key.name,
                apiKey: key.apiKey,
                isActive: key.isActive,
                createdAt: key.createdAt,
                lastUsed: key.lastUsed,
                totalRequests: key.totalRequests,
                totalStorage: key.totalStorage,
                totalBandwidth: key.totalBandwidth,
            })),
        })
    } catch (error) {
        console.error("Get API keys error:", error)
        return NextResponse.json({ message: "Failed to get API keys" }, { status: 500 })
    }
}

// Create new API key
async function createApiKeyHandler(req: AuthenticatedRequest): Promise<NextResponse> {
    try {
        const body = await req.json()
        const { name } = body

        if (!name) {
            return NextResponse.json({ message: "API key name is required" }, { status: 400 })
        }

        const userId = req.user!.uid
        const apiKey = generateApiKey()

        const apiKeyData = await createApiKeyAdmin(userId, apiKey, name)

        return NextResponse.json({
            success: true,
            message: "API key created successfully",
            data: {
                id: apiKeyData.id,
                name: apiKeyData.name,
                apiKey: apiKeyData.apiKey,
                createdAt: apiKeyData.createdAt,
            },
        })
    } catch (error) {
        console.error("Create API key error:", error)
        return NextResponse.json({ message: "Failed to create API key" }, { status: 500 })
    }
}

export const GET = withFirebaseAuthToken(getApiKeysHandler)
export const POST = withFirebaseAuthToken(createApiKeyHandler)
