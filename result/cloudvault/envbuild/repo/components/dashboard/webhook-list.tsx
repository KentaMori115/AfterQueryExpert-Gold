"use client"

import { useState } from "react"
import { WebhookEndpoint } from "@/lib/webhook"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Webhook, Plus, Trash2, CheckCircle, AlertCircle, RefreshCw, Send } from "lucide-react"

interface WebhookListProps {
    endpoints: WebhookEndpoint[]
    onRefresh: () => void
    onOpenCreate: () => void
    onOpenDeliveries: () => void
    onOpenTest: (endpoint: WebhookEndpoint) => void
    apiKey: string
}

export function WebhookList({
    endpoints,
    onRefresh,
    onOpenCreate,
    onOpenDeliveries,
    onOpenTest,
    apiKey,
}: WebhookListProps) {
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this webhook endpoint?")) return
        setDeletingId(id)
        try {
            const res = await fetch(`/api/webhooks/endpoints/${id}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            })
            if (res.ok) {
                onRefresh()
            } else {
                const data = await res.json()
                alert(data.error || "Failed to delete endpoint")
            }
        } catch (err) {
            alert("An error occurred while deleting webhook")
        } finally {
            setDeletingId(null)
        }
    }

    return (
        <Card className="w-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <Webhook className="h-5 w-5 text-indigo-500" />
                        Webhook Endpoints
                    </CardTitle>
                    <CardDescription>
                        Receive real-time HTTP POST notifications when storage events occur.
                    </CardDescription>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={onOpenDeliveries}>
                        <RefreshCw className="h-4 w-4 mr-1" /> View Logs
                    </Button>
                    <Button size="sm" onClick={onOpenCreate} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                        <Plus className="h-4 w-4 mr-1" /> Add Endpoint
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {endpoints.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                        <Webhook className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-50" />
                        <p className="font-medium">No Webhook Endpoints Configured</p>
                        <p className="text-sm text-slate-500 mb-4">
                            Register an HTTP URL to listen for file upload, delete, and share events.
                        </p>
                        <Button size="sm" onClick={onOpenCreate}>
                            Add Your First Webhook
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {endpoints.map((ep) => (
                            <div
                                key={ep.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg hover:border-indigo-200 transition-colors bg-card gap-3"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-semibold text-sm truncate max-w-md">
                                            {ep.url}
                                        </span>
                                        {ep.isActive ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                                <CheckCircle className="h-3 w-3 mr-1" /> Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                                <AlertCircle className="h-3 w-3 mr-1" /> Inactive
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                        <span>Events:</span>
                                        {ep.events.map((ev) => (
                                            <span key={ev} className="bg-secondary px-1.5 py-0.5 rounded font-mono text-[11px]">
                                                {ev}
                                            </span>
                                        ))}
                                    </div>
                                    {ep.description && (
                                        <p className="text-xs text-slate-500 italic">{ep.description}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 self-end sm:self-center">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onOpenTest(ep)}
                                        className="h-8 text-xs"
                                    >
                                        <Send className="h-3.5 w-3.5 mr-1" /> Test Ping
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDelete(ep.id)}
                                        disabled={deletingId === ep.id}
                                        className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                                    >
                                        <Trash2 className="h-4 w-4" />
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
