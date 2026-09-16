import crypto from "crypto"

function getShareSecret(): string {
    const secret = process.env.SHARE_SECRET
    if (!secret) {
        throw new Error("SHARE_SECRET environment variable is not set")
    }
    return secret
}

export interface ShareTokenPayload {
    fileId: string
    expiresAt: number // Timestamp in ms
}

/**
 * Generates a base64url encoded cryptographically signed sharing token.
 */
export function generateShareToken(fileId: string, ttlSeconds: number): string {
    const expiresAt = Date.now() + ttlSeconds * 1000
    const payload: ShareTokenPayload = { fileId, expiresAt }
    
    const payloadStr = JSON.stringify(payload)
    const payloadBase64 = Buffer.from(payloadStr).toString("base64url")
    
    const signature = crypto
        .createHmac("sha256", getShareSecret())
        .update(payloadBase64)
        .digest("base64url")
        
    return `${payloadBase64}.${signature}`
}

/**
 * Verifies a sharing token. Returns payload if valid, or null if expired/tampered.
 */
export function verifyShareToken(token: string): ShareTokenPayload | null {
    try {
        const parts = token.split(".")
        if (parts.length !== 2) return null
        
        const [payloadBase64, signature] = parts
        
        // Re-calculate signature
        const expectedSignature = crypto
            .createHmac("sha256", getShareSecret())
            .update(payloadBase64)
            .digest("base64url")
            
        if (signature !== expectedSignature) {
            return null // Signature mismatch (tampered)
        }
        
        const payloadStr = Buffer.from(payloadBase64, "base64url").toString("utf8")
        const payload = JSON.parse(payloadStr) as ShareTokenPayload
        
        // Check expiration
        if (Date.now() > payload.expiresAt) {
            return null // Expired
        }
        
        return payload
    } catch (e) {
        console.error("Token verification error:", e)
        return null
    }
}
