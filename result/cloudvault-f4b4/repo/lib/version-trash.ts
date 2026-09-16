import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { StoredFileMetadata } from "./firestore-admin"

function getAdminDb() {
    return getFirestore()
}

export interface TrashedItem {
    id: string
    fileId: string
    userId: string
    originalFilename: string
    size: number
    filePath: string
    extension: string
    trashedAt: Date
    expiresAt: Date
}

export interface FileVersion {
    id: string
    fileId: string
    userId: string
    versionNumber: number
    filePath: string
    originalFilename: string
    size: number
    createdAt: Date
}

/**
 * Soft-deletes a file by moving its metadata into the 'trash' collection.
 */
export async function moveToTrash(userId: string, fileId: string): Promise<boolean> {
    try {
        const fileRef = getAdminDb().collection("files").doc(fileId)
        const snap = await fileRef.get()

        if (!snap.exists || snap.data()?.userId !== userId) {
            return false
        }

        const data = snap.data() as any
        const trashedAt = new Date()
        const expiresAt = new Date(trashedAt.getTime() + 30 * 24 * 3600 * 1000) // 30 days retention

        const trashData = {
            fileId: data.fileId || snap.id,
            userId,
            originalFilename: data.originalFilename || "Untitled",
            size: data.size || 0,
            filePath: data.filePath || "",
            extension: data.extension || "",
            trashedAt: FieldValue.serverTimestamp(),
            expiresAt,
        }

        await getAdminDb().collection("trash").doc(fileId).set(trashData)
        await fileRef.delete()

        return true
    } catch (err) {
        console.error("Failed to move file to trash:", err)
        return false
    }
}

/**
 * Restores a file from trash back to active storage.
 */
export async function restoreFromTrash(userId: string, fileId: string): Promise<boolean> {
    try {
        const trashRef = getAdminDb().collection("trash").doc(fileId)
        const snap = await trashRef.get()

        if (!snap.exists || snap.data()?.userId !== userId) {
            return false
        }

        const data = snap.data() as any
        const restoredData: Omit<StoredFileMetadata, "createdAt"> & { createdAt: any } = {
            userId,
            apiKeyId: data.apiKeyId || "",
            fileId: data.fileId,
            filePath: data.filePath,
            originalFilename: data.originalFilename,
            extension: data.extension,
            size: data.size,
            createdAt: FieldValue.serverTimestamp(),
        }

        await getAdminDb().collection("files").doc(fileId).set(restoredData)
        await trashRef.delete()

        return true
    } catch (err) {
        console.error("Failed to restore file from trash:", err)
        return false
    }
}

/**
 * Permanently deletes a file from the trash collection.
 */
export async function purgeFromTrash(userId: string, fileId: string): Promise<boolean> {
    try {
        const trashRef = getAdminDb().collection("trash").doc(fileId)
        const snap = await trashRef.get()
        if (snap.exists && snap.data()?.userId === userId) {
            await trashRef.delete()
            return true
        }
        return false
    } catch (err) {
        console.error("Failed to purge file from trash:", err)
        return false
    }
}

/**
 * Retrieves all items currently in the trash for a user.
 */
export async function getUserTrash(userId: string): Promise<TrashedItem[]> {
    try {
        const snap = await getAdminDb()
            .collection("trash")
            .where("userId", "==", userId)
            .get()

        const items = snap.docs.map((doc) => {
            const d = doc.data() as any
            return {
                id: doc.id,
                fileId: d.fileId || doc.id,
                userId: d.userId,
                originalFilename: d.originalFilename || "Untitled",
                size: d.size || 0,
                filePath: d.filePath || "",
                extension: d.extension || "",
                trashedAt: d.trashedAt?.toDate?.() || new Date(),
                expiresAt: d.expiresAt?.toDate?.() || new Date(),
            }
        })

        items.sort((a, b) => b.trashedAt.getTime() - a.trashedAt.getTime())
        return items
    } catch (err) {
        console.error("Failed to list trash items:", err)
        return []
    }
}

/**
 * Records a new version entry when a file is updated.
 */
export async function saveFileVersion(meta: StoredFileMetadata): Promise<void> {
    try {
        const versionsSnap = await getAdminDb()
            .collection("file_versions")
            .where("fileId", "==", meta.fileId)
            .get()

        const versionNumber = versionsSnap.size + 1

        await getAdminDb().collection("file_versions").add({
            fileId: meta.fileId,
            userId: meta.userId,
            versionNumber,
            filePath: meta.filePath,
            originalFilename: meta.originalFilename,
            size: meta.size,
            createdAt: FieldValue.serverTimestamp(),
        })
    } catch (err) {
        console.error("Failed to save file version:", err)
    }
}

/**
 * Retrieves all version history records for a file.
 */
export async function getFileVersions(userId: string, fileId: string): Promise<FileVersion[]> {
    try {
        const snap = await getAdminDb()
            .collection("file_versions")
            .where("userId", "==", userId)
            .where("fileId", "==", fileId)
            .get()

        const versions = snap.docs.map((doc) => {
            const d = doc.data() as any
            return {
                id: doc.id,
                fileId: d.fileId,
                userId: d.userId,
                versionNumber: d.versionNumber || 1,
                filePath: d.filePath || "",
                originalFilename: d.originalFilename || "Untitled",
                size: d.size || 0,
                createdAt: d.createdAt?.toDate?.() || new Date(),
            }
        })

        versions.sort((a, b) => b.versionNumber - a.versionNumber)
        return versions
    } catch (err) {
        console.error("Failed to retrieve file versions:", err)
        return []
    }
}
