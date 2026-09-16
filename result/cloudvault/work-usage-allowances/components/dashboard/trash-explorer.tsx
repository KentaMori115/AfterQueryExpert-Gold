"use client"

import { useState } from "react"
import { TrashedItem } from "@/lib/version-trash"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Trash2, RotateCcw, AlertTriangle, FileText, HardDrive } from "lucide-react"

interface TrashExplorerProps {
    items: TrashedItem[]
    onRefresh: () => void
    apiKey: string
}

export function TrashExplorer({ items, onRefresh, apiKey }: TrashExplorerProps) {
    const [actionId, setActionId] = useState<string | null>(null)

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return "0 B"
        const k = 1024
        const sizes = ["B", "KB", "MB", "GB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
    }

    const handleRestore = async (fileId: string) => {
        setActionId(fileId)
        try {
            const res = await fetch(`/api/trash/${fileId}/restore`, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}` },
            })
            if (res.ok) {
                onRefresh()
            } else {
                alert("Failed to restore file")
            }
        } catch (err) {
            alert("Error restoring file")
        } finally {
            setActionId(null)
        }
    }

    const handlePurge = async (fileId: string) => {
        if (!confirm("Permanently delete this file? This action cannot be undone.")) return
        setActionId(fileId)
        try {
            const res = await fetch(`/api/trash/${fileId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${apiKey}` },
            })
            if (res.ok) {
                onRefresh()
            } else {
                alert("Failed to purge file")
            }
        } catch (err) {
            alert("Error purging file")
        } finally {
            setActionId(null)
        }
    }

    return (
        <Card className="w-full">
            <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                    <Trash2 className="h-5 w-5 text-rose-500" />
                    Recycle Bin (Trash)
                </CardTitle>
                <CardDescription>
                    Items in trash are retained for 30 days before permanent deletion.
                </CardDescription>
            </CardHeader>

            <CardContent>
                {items.length === 0 ? (
                    <div className="text-center py-10 border border-dashed rounded-lg text-slate-500">
                        <Trash2 className="h-10 w-10 mx-auto mb-2 opacity-30" />
                        <p className="font-medium">Recycle Bin is Empty</p>
                        <p className="text-xs">Soft-deleted files will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {items.map((item) => (
                            <div
                                key={item.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors text-xs gap-2"
                            >
                                <div className="flex items-center gap-3">
                                    <FileText className="h-5 w-5 text-slate-400 shrink-0" />
                                    <div>
                                        <p className="font-semibold text-foreground truncate max-w-sm">
                                            {item.originalFilename}
                                        </p>
                                        <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                                            <span>{formatBytes(item.size)}</span>
                                            <span>•</span>
                                            <span>Deleted: {new Date(item.trashedAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 self-end sm:self-center">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRestore(item.fileId)}
                                        disabled={actionId === item.fileId}
                                        className="h-8 text-xs text-indigo-600 hover:text-indigo-700"
                                    >
                                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handlePurge(item.fileId)}
                                        disabled={actionId === item.fileId}
                                        className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                    >
                                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Purge
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
