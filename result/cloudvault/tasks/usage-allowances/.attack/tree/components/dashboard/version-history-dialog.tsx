"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FileVersion } from "@/lib/version-trash"
import { History, Clock, FileCheck } from "lucide-react"

interface VersionHistoryDialogProps {
    fileId: string | null
    isOpen: boolean
    onClose: () => void
    apiKey: string
}

export function VersionHistoryDialog({ fileId, isOpen, onClose, apiKey }: VersionHistoryDialogProps) {
    const [versions, setVersions] = useState<FileVersion[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (isOpen && fileId) {
            setLoading(true)
            fetch(`/api/file/${fileId}/versions`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            })
                .then((res) => res.json())
                .then((data) => setVersions(data.versions || []))
                .catch((err) => console.error(err))
                .finally(() => setLoading(false))
        }
    }, [isOpen, fileId])

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return "0 B"
        const k = 1024
        const sizes = ["B", "KB", "MB", "GB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <History className="h-5 w-5 text-indigo-500" />
                        Version History
                    </DialogTitle>
                    <DialogDescription>
                        Audit of file iterations for <code className="bg-secondary px-1 rounded">{fileId}</code>.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-2 pt-2 pr-1">
                    {loading ? (
                        <div className="text-center py-8 text-xs text-slate-500">Loading version history...</div>
                    ) : versions.length === 0 ? (
                        <div className="text-center py-8 text-xs text-slate-500">
                            No previous versions recorded for this file.
                        </div>
                    ) : (
                        versions.map((v) => (
                            <div key={v.id} className="p-3 border rounded-md text-xs bg-card space-y-1">
                                <div className="flex items-center justify-between font-medium">
                                    <span className="flex items-center gap-1.5 text-indigo-600">
                                        <FileCheck className="h-4 w-4" /> Version {v.versionNumber}
                                    </span>
                                    <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                                        <Clock className="h-3 w-3" /> {new Date(v.createdAt).toLocaleString()}
                                    </span>
                                </div>
                                <div className="text-slate-500 flex justify-between pt-1 text-[11px]">
                                    <span>Filename: {v.originalFilename}</span>
                                    <span>Size: {formatBytes(v.size)}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
