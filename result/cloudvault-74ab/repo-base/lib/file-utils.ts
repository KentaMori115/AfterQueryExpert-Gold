// Pure file helpers shared by API routes and the dashboard UI.

export const MAX_FILE_SIZE = 250 * 1024 * 1024 // 250MB (Bypasses standard 50MB bot upload limit via chunking)


export const MIME_TYPES: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    pdf: "application/pdf",
    txt: "text/plain",
}

// Derive a lowercase extension without the dot from a filename.
export function getExtension(filename: string): string {
    return filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : ""
}

// Format a byte count as "N.NN MB" (used in API responses and Telegram captions).
export function formatSizeMB(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// Human-readable byte count (Bytes/KB/MB/GB) used by the dashboard cards.
export function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

// Strip the final extension from a file path or name.
export function stripExtension(path: string): string {
    return path.replace(/\.[^/.]+$/, "")
}

// Map an extension to a Content-Type, falling back to octet-stream.
export function getContentType(extension: string): string {
    return MIME_TYPES[extension.toLowerCase()] || "application/octet-stream"
}

// Build the filename used for a forced download. Ensures the stored extension
// is present exactly once on the served file.
export function buildDownloadFilename(originalFilename: string, extension: string): string {
    if (!extension) return originalFilename
    if (originalFilename.endsWith(`.${extension}`)) return originalFilename
    return `${stripExtension(originalFilename)}.${extension}`
}

// Last segment of a Telegram file_path (e.g. "documents/file_7" -> "file_7").
export function getFileNameFromPath(filePath: string, fallback: string): string {
    const parts = filePath.split("/")
    return parts[parts.length - 1] || fallback
}
