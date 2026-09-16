import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { type UserProfile, type ApiKeyData, type UsageRecord } from "./firestore"

// Lazily resolve the default app so imports never crash when credentials are
// missing (e.g. during build or page-data collection).
function getAdminDb() {
    return getFirestore()
}

// File metadata interface for persistent Telegram file references
export interface StoredFileMetadata {
    userId: string
    apiKeyId: string
    fileId: string
    filePath: string // Telegram's stable file_path (e.g. documents/file_7)
    originalFilename: string
    extension: string // Lowercase without dot
    size: number // bytes
    createdAt: Date
    chunks?: string[]
    chunkPaths?: string[]
}

// Save user profile (separate from API keys)
export const saveUserProfileAdmin = async (
    userId: string,
    email: string,
    botToken: string,
    chatId: string,
): Promise<void> => {
    const userRef = getAdminDb().collection("users").doc(userId)
    const userData: Omit<UserProfile, "createdAt" | "updatedAt"> & { createdAt: any; updatedAt: any } = {
        email,
        botToken,
        chatId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }
    await userRef.set(userData, { merge: true })
}

// Create new API key for user
export const createApiKeyAdmin = async (
    userId: string,
    apiKey: string,
    name = "Default API Key",
): Promise<ApiKeyData> => {
    const apiKeyData: Omit<ApiKeyData, "id" | "createdAt" | "updatedAt"> & { createdAt: any; updatedAt: any } = {
        userId,
        apiKey,
        name,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        totalRequests: 0,
        totalStorage: 0,
        totalBandwidth: 0,
    }

    const docRef = await getAdminDb().collection("apiKeys").add(apiKeyData)

    return {
        id: docRef.id,
        userId,
        apiKey,
        name,
        isActive: true,
        createdAt: new Date(), // Return a client-side date for immediate use
        updatedAt: new Date(),
        totalRequests: 0,
        totalStorage: 0,
        totalBandwidth: 0,
    }
}

// Deactivate API key
export const deactivateApiKeyAdmin = async (apiKeyId: string): Promise<void> => {
    const apiKeyRef = getAdminDb().collection("apiKeys").doc(apiKeyId)
    await apiKeyRef.update({
        isActive: false,
        updatedAt: FieldValue.serverTimestamp(),
    })
}

// Record usage and update statistics
export const recordUsageAdmin = async (
    userId: string,
    apiKeyId: string,
    type: "upload" | "download" | "delete" | "list",
    fileSize = 0,
    success = true,
    endpoint = "",
): Promise<void> => {
    // Record individual usage
    const usageData: Omit<UsageRecord, "timestamp"> & { timestamp: any } = {
        userId,
        apiKeyId,
        type,
        fileSize,
        timestamp: FieldValue.serverTimestamp(),
        success,
        endpoint,
    }
    await getAdminDb().collection("usage").add(usageData)

    // Update API key statistics
    const apiKeyRef = getAdminDb().collection("apiKeys").doc(apiKeyId)
    const updateData: any = {
        totalRequests: FieldValue.increment(1),
        lastUsed: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }

    if (type === "upload") {
        updateData.totalStorage = FieldValue.increment(fileSize)
        updateData.totalBandwidth = FieldValue.increment(fileSize)
    } else if (type === "download") {
        updateData.totalBandwidth = FieldValue.increment(fileSize)
    }

    await apiKeyRef.update(updateData)
}

// Save file metadata (do NOT store full URL containing bot token, only file_path)
export const saveFileMetadataAdmin = async (meta: Omit<StoredFileMetadata, "createdAt">): Promise<void> => {
    const data = {
        ...meta,
        extension: meta.extension?.toLowerCase() || "",
        createdAt: FieldValue.serverTimestamp(),
    }
    // Write a canonical latest document keyed by fileId to avoid expensive queries and index requirements.
    // Also keep an append-only history collection for auditing.
    try {
        const latestRef = getAdminDb().collection("files").doc(meta.fileId)
        await latestRef.set(data, { merge: true })
    } catch (err) {
        console.warn("Failed to write latest file metadata by ID, falling back to add():", err)
        await getAdminDb().collection("files").add(data)
    }

    // Append to history collection (optional, for audit trail)
    try {
        await getAdminDb().collection("files_history").add(data)
    } catch (err) {
        console.warn("Failed to write file history entry:", err)
    }
}

// Retrieve file metadata by Telegram file_id
export const getFileMetadataAdmin = async (fileId: string): Promise<StoredFileMetadata | null> => {
    // First try to read the canonical latest document stored by fileId (constant time, no index required)
    try {
        const docRef = getAdminDb().collection("files").doc(fileId)
        const docSnap = await docRef.get()
        if (docSnap.exists) {
            const data = docSnap.data() as any
            return {
                userId: data.userId,
                apiKeyId: data.apiKeyId,
                fileId: data.fileId,
                filePath: data.filePath,
                originalFilename: data.originalFilename,
                extension: data.extension || "",
                size: data.size || 0,
                createdAt: data.createdAt?.toDate?.() || new Date(),
                chunks: data.chunks || null,
                chunkPaths: data.chunkPaths || null,
            }
        }
    } catch (err) {
        console.warn("Failed to fetch latest file metadata by ID:", err)
    }

    // Fallback: query history (may require index). This preserves compatibility with previously written records.
    try {
        const snapshot = await getAdminDb()
            .collection("files")
            .where("fileId", "==", fileId)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get()

        if (snapshot.empty) return null

        const doc = snapshot.docs[0]
        const data = doc.data() as any
        return {
            userId: data.userId,
            apiKeyId: data.apiKeyId,
            fileId: data.fileId,
            filePath: data.filePath,
            originalFilename: data.originalFilename,
            extension: data.extension || "",
            size: data.size || 0,
            createdAt: data.createdAt?.toDate?.() || new Date(),
            chunks: data.chunks || null,
            chunkPaths: data.chunkPaths || null,
        }
    } catch (err) {
        console.error("Error querying file metadata fallback:", err)
        return null
    }
}

// Find user profile matching a Telegram chat ID
export const getUserByChatIdAdmin = async (chatId: string): Promise<any | null> => {
    try {
        const snapshot = await getAdminDb()
            .collection("users")
            .where("chatId", "==", chatId.toString())
            .limit(1)
            .get()
        if (!snapshot.empty) {
            const doc = snapshot.docs[0]
            return {
                uid: doc.id,
                ...doc.data(),
            }
        }
        return null
    } catch (e) {
        console.error("Error finding user by Telegram chatId:", e)
        return null
    }
}


// Get paginated list of user files with optional search and type filtering
export const getUserFilesAdmin = async (
    userId: string,
    options: {
        search?: string
        type?: string
        page?: number
        limit?: number
    } = {}
): Promise<{ files: StoredFileMetadata[]; total: number; page: number; totalPages: number }> => {
    const page = Math.max(1, options.page || 1)
    const limit = Math.min(100, Math.max(1, options.limit || 10))

    try {
        const snapshot = await getAdminDb()
            .collection("files")
            .where("userId", "==", userId)
            .get()

        let allFiles: StoredFileMetadata[] = snapshot.docs.map((doc) => {
            const data = doc.data() as any
            return {
                userId: data.userId,
                apiKeyId: data.apiKeyId || "",
                fileId: data.fileId || doc.id,
                filePath: data.filePath || "",
                originalFilename: data.originalFilename || "Untitled",
                extension: data.extension || "",
                size: data.size || 0,
                createdAt: data.createdAt?.toDate?.() || new Date(),
            }
        })

        // Sort descending by creation date
        allFiles.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

        // In-memory search filter
        if (options.search && options.search.trim() !== "") {
            const q = options.search.toLowerCase().trim()
            allFiles = allFiles.filter(
                (f) =>
                    f.originalFilename.toLowerCase().includes(q) ||
                    f.fileId.toLowerCase().includes(q) ||
                    f.extension.toLowerCase().includes(q)
            )
        }

        // Category / Type filter
        if (options.type && options.type !== "all") {
            const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"]
            const docExts = ["pdf", "doc", "docx", "txt", "rtf", "md", "csv", "xlsx", "pptx"]
            const audioExts = ["mp3", "wav", "ogg", "flac", "m4a", "aac"]
            const videoExts = ["mp4", "mkv", "avi", "mov", "webm"]
            const archiveExts = ["zip", "rar", "tar", "gz", "7z"]

            allFiles = allFiles.filter((f) => {
                const ext = f.extension.toLowerCase()
                if (options.type === "image") return imageExts.includes(ext)
                if (options.type === "document") return docExts.includes(ext)
                if (options.type === "audio") return audioExts.includes(ext)
                if (options.type === "video") return videoExts.includes(ext)
                if (options.type === "archive") return archiveExts.includes(ext)
                return true
            })
        }

        const total = allFiles.length
        const totalPages = Math.ceil(total / limit) || 1
        const startIndex = (page - 1) * limit
        const paginatedFiles = allFiles.slice(startIndex, startIndex + limit)

        return {
            files: paginatedFiles,
            total,
            page,
            totalPages,
        }
    } catch (err) {
        console.error("Error in getUserFilesAdmin:", err)
        return { files: [], total: 0, page: 1, totalPages: 1 }
    }
}

// Delete file metadata for a specific user
export const deleteFileMetadataAdmin = async (userId: string, fileId: string): Promise<boolean> => {
    try {
        const docRef = getAdminDb().collection("files").doc(fileId)
        const docSnap = await docRef.get()
        if (docSnap.exists && docSnap.data()?.userId === userId) {
            await docRef.delete()
            return true
        }
        return false
    } catch (err) {
        console.error("Error in deleteFileMetadataAdmin:", err)
        return false
    }
}

// Extract daily analytics for dashboard time-series visualization
export const getUserAnalyticsAdmin = async (
    userId: string,
    days: number = 7
): Promise<{
    timeline: { date: string; uploads: number; downloads: number; bandwidth: number }[]
    totals: { totalRequests: number; totalBandwidth: number; activeFilesCount: number }
}> => {
    try {
        const now = new Date()
        const startDate = new Date()
        startDate.setDate(now.getDate() - days)

        const usageSnap = await getAdminDb()
            .collection("usage")
            .where("userId", "==", userId)
            .get()

        const dateMap: Record<string, { uploads: number; downloads: number; bandwidth: number }> = {}

        // Pre-fill last N days
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date()
            d.setDate(now.getDate() - i)
            const dateStr = d.toISOString().split("T")[0]
            dateMap[dateStr] = { uploads: 0, downloads: 0, bandwidth: 0 }
        }

        let totalRequests = 0
        let totalBandwidth = 0

        usageSnap.docs.forEach((doc) => {
            const data = doc.data() as any
            const ts: Date = data.timestamp?.toDate?.() || new Date()
            const dateStr = ts.toISOString().split("T")[0]

            totalRequests++
            const bytes = data.fileSize || 0
            totalBandwidth += bytes

            if (dateMap[dateStr]) {
                if (data.type === "upload") {
                    dateMap[dateStr].uploads++
                    dateMap[dateStr].bandwidth += bytes
                } else if (data.type === "download") {
                    dateMap[dateStr].downloads++
                    dateMap[dateStr].bandwidth += bytes
                }
            }
        })

        const filesSnap = await getAdminDb()
            .collection("files")
            .where("userId", "==", userId)
            .get()

        const timeline = Object.keys(dateMap)
            .sort()
            .map((date) => ({
                date,
                ...dateMap[date],
            }))

        return {
            timeline,
            totals: {
                totalRequests,
                totalBandwidth,
                activeFilesCount: filesSnap.size,
            },
        }
    } catch (err) {
        console.error("Error in getUserAnalyticsAdmin:", err)
        return {
            timeline: [],
            totals: { totalRequests: 0, totalBandwidth: 0, activeFilesCount: 0 },
        }
    }
}
