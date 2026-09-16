"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ShareAccessAudit } from "@/lib/share-manager"
import { BarChart2, Globe, Clock, User } from "lucide-react"

interface ShareAnalyticsModalProps {
    shareId: string | null
    isOpen: boolean
    onClose: () => void
    apiKey: string
}

export function ShareAnalyticsModal({ shareId, isOpen, onClose, apiKey }: ShareAnalyticsModalProps) {
    const [audits, setAudits] = useState<ShareAccessAudit[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (isOpen && shareId) {
            setLoading(true)
            fetch(`/api/shares/${shareId}/analytics`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            })
                .then((res) => res.json())
                .then((data) => setAudits(data.audits || []))
                .catch((err) => console.error(err))
                .finally(() => setLoading(false))
        }
    }, [isOpen, shareId, apiKey])

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BarChart2 className="h-5 w-5 text-indigo-500" />
                        Share Access Analytics
                    </DialogTitle>
                    <DialogDescription>
                        Download audit log for share reference <code className="bg-secondary px-1 rounded">{shareId}</code>.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-2 pt-2 pr-1">
                    {loading ? (
                        <div className="text-center py-10 text-xs text-slate-500">Loading audit events...</div>
                    ) : audits.length === 0 ? (
                        <div className="text-center py-10 text-xs text-slate-500">
                            No download access events recorded yet for this share link.
                        </div>
                    ) : (
                        audits.map((a) => (
                            <div key={a.id} className="p-3 border rounded-md text-xs bg-card space-y-1">
                                <div className="flex justify-between items-center text-slate-500">
                                    <span className="font-mono flex items-center gap-1 font-semibold text-foreground">
                                        <Globe className="h-3.5 w-3.5 text-indigo-500" /> IP: {a.ip}
                                    </span>
                                    <span className="flex items-center gap-1 text-[11px]">
                                        <Clock className="h-3 w-3" /> {new Date(a.timestamp).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono truncate">
                                    <User className="h-3 w-3" /> {a.userAgent}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
