// This file replaces the old MongoDB models
// All data is now stored in Firebase Firestore

export interface User {
    uid: string
    email: string
    botToken: string
    chatId: string
    apiKey: string
    createdAt: Date
    updatedAt: Date
}

export interface ApiUsage {
    userId: string
    endpoint: string
    timestamp: Date
    success: boolean
}

// These interfaces are now handled by Firestore collections:
// - users: User data with Telegram configuration
// - apiUsage: API usage tracking
// - rateLimit: Rate limiting data (stored in Redis)
