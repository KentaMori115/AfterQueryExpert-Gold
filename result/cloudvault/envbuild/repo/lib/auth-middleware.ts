import { type NextRequest, NextResponse } from "next/server"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"

// Initialize Firebase Admin with service account
if (!getApps().length) {
    try {
        const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
        const privateKey = process.env.FIREBASE_PRIVATE_KEY

        if (clientEmail && privateKey) {
            initializeApp({
                credential: cert({
                    projectId,
                    clientEmail,
                    privateKey: privateKey.replace(/\\n/g, "\n"),
                }),
            })
        } else {
            console.warn("Firebase Admin credentials (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) not found in env. Falling back to default initialization.")
            initializeApp({
                projectId,
            })
        }
    } catch (error) {
        console.error("Firebase Admin initialization error:", error)
    }
}

// Lazily resolve the default app so imports never crash when credentials are
// missing (e.g. during build or page-data collection).
function getAdminDb() {
    return getFirestore()
}

function getAdminAuth() {
    return getAuth()
}

export interface AuthenticatedRequest extends NextRequest {
    user?: {
        uid: string
        email?: string
    }
    userConfig?: {
        botToken: string
        chatId: string
    }
    apiKeyData?: {
        id: string
        apiKey: string
        name: string
        userId: string
    }
}

export interface AuthResult {
    authenticated: boolean
    userId?: string
    error?: string
}

// Firebase ID token authentication for routes that need a simple await-style check.
export async function authenticateRequest(req: NextRequest): Promise<AuthResult> {
    try {
        const authHeader = req.headers.get("authorization")

        if (!authHeader?.startsWith("Bearer ")) {
            return { authenticated: false, error: "Missing auth token" }
        }

        const idToken = authHeader.split("Bearer ")[1]
        try {
            const decodedToken = await getAdminAuth().verifyIdToken(idToken)
            return { authenticated: true, userId: decodedToken.uid }
        } catch (tokenError) {
            console.error("Token verification error:", tokenError)
            return { authenticated: false, error: "Invalid token" }
        }
    } catch (error) {
        console.error("Auth middleware error:", error)
        return { authenticated: false, error: "Authentication failed" }
    }
}

// Middleware for API key authentication (for API routes)
export function withFirebaseAuth(
    handler: (req: AuthenticatedRequest, context: { params: any }) => Promise<NextResponse>,
) {
    return async (req: NextRequest, context: { params: any }): Promise<NextResponse> => {
        try {
            // Check for API key in headers
            const authHeader = req.headers.get("authorization")
            const apiKey = authHeader?.replace("Bearer ", "")

            if (!apiKey) {
                return NextResponse.json({ message: "Missing API key" }, { status: 401 })
            }

            // Find API key in Firestore
            const apiKeysRef = getAdminDb().collection("apiKeys")
            const apiKeyQuery = await apiKeysRef.where("apiKey", "==", apiKey).where("isActive", "==", true).get()

            if (apiKeyQuery.empty) {
                return NextResponse.json({ message: "Invalid API key" }, { status: 401 })
            }

            const apiKeyDoc = apiKeyQuery.docs[0]
            const apiKeyData = apiKeyDoc.data()

            // Get user profile
            const userRef = getAdminDb().collection("users").doc(apiKeyData.userId)
            const userDoc = await userRef.get()

            if (!userDoc.exists) {
                return NextResponse.json({ message: "User not found" }, { status: 401 })
            }

            const userData = userDoc.data()!

            // Attach data to request
            const authenticatedReq = req as AuthenticatedRequest
            authenticatedReq.user = {
                uid: apiKeyData.userId,
                email: userData.email,
            }
            authenticatedReq.userConfig = {
                botToken: userData.botToken,
                chatId: userData.chatId,
            }
            authenticatedReq.apiKeyData = {
                id: apiKeyDoc.id,
                apiKey: apiKeyData.apiKey,
                name: apiKeyData.name,
                userId: apiKeyData.userId,
            }

            return handler(authenticatedReq, context)
        } catch (error) {
            console.error("Auth middleware error:", error)
            return NextResponse.json({ message: "Authentication failed" }, { status: 401 })
        }
    }
}

// Middleware for Firebase ID token authentication (for dashboard routes)
export function withFirebaseAuthToken(
    handler: (req: AuthenticatedRequest, context: { params: any }) => Promise<NextResponse>,
) {
    return async (req: NextRequest, context: { params: any }): Promise<NextResponse> => {
        try {
            const authHeader = req.headers.get("authorization")

            if (!authHeader?.startsWith("Bearer ")) {
                return NextResponse.json({ message: "Missing auth token" }, { status: 401 })
            }

            const idToken = authHeader.split("Bearer ")[1]
            try {
                const decodedToken = await getAdminAuth().verifyIdToken(idToken)

                const authenticatedReq = req as AuthenticatedRequest
                authenticatedReq.user = {
                    uid: decodedToken.uid,
                    email: decodedToken.email,
                }

                return handler(authenticatedReq, context)
            } catch (tokenError) {
                console.error("Token verification error:", tokenError)
                return NextResponse.json({ message: "Invalid token" }, { status: 401 })
            }
        } catch (error) {
            console.error("Auth middleware error:", error)
            return NextResponse.json({ message: "Authentication failed" }, { status: 401 })
        }
    }
}
