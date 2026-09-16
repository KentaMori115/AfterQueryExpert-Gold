"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { WebhookEndpoint } from "@/lib/webhook"
import { Send, CheckCircle, AlertTriangle } from "lucide-react"

interface WebhookTestDialogProps {
    endpoint: WebhookEndpoint | null
    isOpen: boolean
    onClose: () => void
    apiKey: string
}

export function WebhookTestDialog({ endpoint, isOpen, onClose, apiKey }: WebhookTestDialogProps) {
    const [sending, setSending] = useState(false)
    const [result, setResult] = useState<any | null>(null)

    const sendTestPing = async () => {
        if (!endpoint) return
        setSending(true)
        setResult(null)

        try {
            const res = await fetch(`/api/webhooks/deliveries`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            })
            // Execute dummy event dispatch test
            const pingRes = await fetch(endpoint.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CloudVault-Event": "ping.test",
                },
                body: JSON.stringify({
                    event: "ping.test",
                    message: "CloudVault storage API test webhook event",
                    timestamp: new Date().toISOString(),
                }),
            })
            setResult({
                status: pingRes.status,
                ok: pingRes.ok,
                statusText: pingRes.statusText,
            })
        } catch (err: any) {
            setResult({ ok: false, error: err.message || "Failed to deliver ping request" })
        } finally {
            setSending(false)
        }
    }

    if (!endpoint) return null

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Send Test Ping</DialogTitle>
                    <DialogDescription>
                        Send a test JSON payload to <span className="font-mono font-medium text-foreground">{endpoint.url}</span>.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2 text-xs">
                    {result && (
                        <div
                            className={`p-3 rounded border font-mono ${
                                result.ok
                                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                    : "bg-rose-50 text-rose-800 border-rose-200"
                            }`}
                        >
                            <div className="flex items-center gap-1.5 font-bold mb-1">
                                {result.ok ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                                {result.ok ? "Ping Successful" : "Ping Failed"}
                            </div>
                            <p>Status: {result.status || "N/A"}</p>
                            {result.error && <p>Error: {result.error}</p>}
                        </div>
                    )}

                    <div className="bg-muted p-3 rounded font-mono text-[11px] overflow-x-auto space-y-1">
                        <p className="text-slate-400">{`// Sample Ping Payload`}</p>
                        <p>
                            {JSON.stringify(
                                {
                                    event: "ping.test",
                                    message: "CloudVault storage API test webhook event",
                                    timestamp: new Date().toISOString(),
                                },
                                null,
                                2
                            )}
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>
                        Close
                    </Button>
                    <Button onClick={sendTestPing} disabled={sending} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                        <Send className="h-3.5 w-3.5 mr-1" /> {sending ? "Sending..." : "Dispatch Test"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
