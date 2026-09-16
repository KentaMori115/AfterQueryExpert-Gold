"use client"

import { useState, useEffect, useCallback } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { WebhookDelivery } from "@/lib/webhook"
import { CheckCircle2, XCircle, RefreshCw, Clock } from "lucide-react"

interface WebhookDeliveryLogProps {
    isOpen: boolean
    onClose: () => void
    apiKey: string
}

export function WebhookDeliveryLog({ isOpen, onClose, apiKey }: WebhookDeliveryLogProps) {
    const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
    const [loading, setLoading] = useState(false)

    const fetchDeliveries = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch("/api/webhooks/deliveries", {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            })
            if (res.ok) {
                const data = await res.json()
                setDeliveries(data.deliveries || [])
            }
        } catch (err) {
            console.error("Failed to load delivery logs:", err)
        } finally {
            setLoading(false)
        }
    }, [apiKey])

    useEffect(() => {
        if (isOpen) {
            fetchDeliveries()
        }
    }, [isOpen, fetchDeliveries])

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                        <DialogTitle>Webhook Delivery Logs</DialogTitle>
                        <DialogDescription>Audit trail of recent HTTP notification deliveries.</DialogDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchDeliveries} disabled={loading}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
                    </Button>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1 pt-2">
                    {deliveries.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground text-sm">
                            No webhook delivery attempts recorded yet.
                        </div>
                    ) : (
                        deliveries.map((log) => (
                            <div key={log.id} className="p-3 border rounded-md text-xs space-y-2 bg-card">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {log.success ? (
                                            <span className="flex items-center text-emerald-600 font-semibold">
                                                <CheckCircle2 className="h-4 w-4 mr-1" /> {log.statusCode || 200} OK
                                            </span>
                                        ) : (
                                            <span className="flex items-center text-rose-600 font-semibold">
                                                <XCircle className="h-4 w-4 mr-1" /> {log.statusCode || "FAILED"}
                                            </span>
                                        )}
                                        <span className="font-mono font-medium px-1.5 py-0.5 bg-secondary rounded text-[11px]">
                                            {log.event}
                                        </span>
                                    </div>
                                    <span className="text-slate-400 flex items-center gap-1">
                                        <Clock className="h-3 w-3" /> {log.durationMs}ms
                                    </span>
                                </div>

                                {log.error && (
                                    <p className="text-rose-500 font-mono text-[11px] bg-rose-50 p-1.5 rounded">
                                        Error: {log.error}
                                    </p>
                                )}

                                <div className="bg-muted p-2 rounded font-mono text-[11px] overflow-x-auto max-h-24">
                                    <span className="text-slate-400">Payload: </span>
                                    {JSON.stringify(log.payload)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
