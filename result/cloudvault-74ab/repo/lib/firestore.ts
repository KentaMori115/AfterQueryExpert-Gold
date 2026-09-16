import { initializeApp, getApps } from "firebase/app"
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    collection,
    addDoc,
    query,
    where,
    getDocs,
    increment,
    serverTimestamp,
} from "firebase/firestore"
import { aggregateUsageStats } from "./stats"

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

let app
if (!getApps().length) {
    app = initializeApp(firebaseConfig)
} else {
    app = getApps()[0]
}

export const db = getFirestore(app)

export interface UserProfile {
    email: string
    botToken: string
    chatId: string
    createdAt: Date
    updatedAt: Date
}

export interface ApiKeyData {
    id: string
    userId: string
    apiKey: string
    name: string
    isActive: boolean
    createdAt: Date
    updatedAt: Date
    // Usage statistics
    totalRequests: number
    totalStorage: number // in bytes
    totalBandwidth: number // in bytes
    lastUsed?: Date
}

export interface UsageRecord {
    userId: string
    apiKeyId: string
    type: "upload" | "download" | "delete" | "list"
    fileSize?: number // for bandwidth tracking
    timestamp: Date
    success: boolean
    endpoint: string
}

// Get user profile
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
    try {
        const userRef = doc(db, "users", userId)
        const userSnap = await getDoc(userRef)

        if (userSnap.exists()) {
            const data = userSnap.data()
            // Convert Firestore Timestamps to Dates
            return {
                ...data,
                createdAt: data.createdAt?.toDate(),
                updatedAt: data.updatedAt?.toDate(),
            } as UserProfile
        }
        return null
    } catch (error) {
        console.error("Error getting user profile:", error)
        return null
    }
}

// Get all API keys for a user
export const getUserApiKeys = async (userId: string): Promise<ApiKeyData[]> => {
    try {
        const apiKeysRef = collection(db, "apiKeys")
        const q = query(apiKeysRef, where("userId", "==", userId), where("isActive", "==", true))
        const querySnapshot = await getDocs(q)

        return querySnapshot.docs.map((doc) => {
            const data = doc.data()
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate(),
                updatedAt: data.updatedAt?.toDate(),
                lastUsed: data.lastUsed?.toDate(),
            } as ApiKeyData
        })
    } catch (error) {
        console.error("Error getting user API keys:", error)
        return []
    }
}

// Test bot token and chat ID
export const testTelegramBot = async (botToken: string, chatId: string): Promise<boolean> => {
    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: "🎉 CloudVault API setup successful! Your bot is now connected.",
            }),
        })

        const result = await response.json()
        return result.ok === true
    } catch (error) {
        console.error("Bot test error:", error)
        return false
    }
}

// Aggregate usage statistics from a list of API keys.
export { aggregateUsageStats }

// Get usage statistics for dashboard
export const getUserUsageStats = async (
    userId: string,
): Promise<{
    totalRequests: number
    totalStorage: number
    totalBandwidth: number
}> => {
    try {
        const apiKeys = await getUserApiKeys(userId)

        const stats = aggregateUsageStats(apiKeys)

        return stats
    } catch (error) {
        console.error("Error getting usage stats:", error)
        return { totalRequests: 0, totalStorage: 0, totalBandwidth: 0 }
    }
}

// Get API key data by key string
export const getApiKeyData = async (apiKey: string): Promise<ApiKeyData | null> => {
    try {
        const apiKeysRef = collection(db, "apiKeys")
        const q = query(apiKeysRef, where("apiKey", "==", apiKey), where("isActive", "==", true))
        const querySnapshot = await getDocs(q)

        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0]
            return {
                id: doc.id,
                ...doc.data(),
            } as ApiKeyData
        }
        return null
    } catch (error) {
        console.error("Error getting API key data:", error)
        return null
    }
}

// Record usage and update statistics
export const recordUsage = async (
    userId: string,
    apiKeyId: string,
    type: "upload" | "download" | "delete" | "list",
    fileSize = 0,
    success = true,
    endpoint = "",
): Promise<void> => {
    try {
        // Record individual usage
        const usageData: UsageRecord = {
            userId,
            apiKeyId,
            type,
            fileSize,
            timestamp: new Date(),
            success,
            endpoint,
        }

        await addDoc(collection(db, "usage"), usageData)

        // Update API key statistics
        const apiKeyRef = doc(db, "apiKeys", apiKeyId)
        const updateData: any = {
            totalRequests: increment(1),
            lastUsed: serverTimestamp(),
            updatedAt: new Date(),
        }

        if (type === "upload") {
            updateData.totalStorage = increment(fileSize)
            updateData.totalBandwidth = increment(fileSize)
        } else if (type === "download") {
            updateData.totalBandwidth = increment(fileSize)
        }

        await updateDoc(apiKeyRef, updateData)
    } catch (error) {
        console.error("Error recording usage:", error)
    }
}

// Deactivate API key
export const deactivateApiKey = async (apiKeyId: string): Promise<void> => {
    try {
        const apiKeyRef = doc(db, "apiKeys", apiKeyId)
        await updateDoc(apiKeyRef, {
            isActive: false,
            updatedAt: new Date(),
        })
    } catch (error) {
        console.error("Error deactivating API key:", error)
        throw new Error("Failed to deactivate API key.")
    }
}
