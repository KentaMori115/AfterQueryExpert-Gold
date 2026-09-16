"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface WebhookModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    apiKey: string
}

const AVAILABLE_EVENTS = [
    { id: "file.uploaded", label: "File Uploaded" },
    { id: "file.deleted", label: "File Deleted" },
    { id: "share.created", label: "Share Link Created" },
    { id: "rate_limit.exceeded", label: "Rate Limit Exceeded" },
]

export function WebhookModal({ isOpen, onClose, onSuccess, apiKey }: WebhookModalProps) {
    const [url, setUrl] = useState("")
    const [description, setDescription] = useState("")
    const [selectedEvents, setSelectedEvents] = useState<string[]>(["file.uploaded", "file.deleted"])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const toggleEvent = (eventId: string) => {
        if (selectedEvents.includes(eventId)) {
            setSelectedEvents(selectedEvents.filter((e) => e !== eventId))
        } else {
            setSelectedEvents([...selectedEvents, eventId])
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setLoading(true)

        try {
            const res = await fetch("/api/webhooks/endpoints", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    url,
                    description,
                    events: selectedEvents.length > 0 ? selectedEvents : ["*"],
                }),
            })

            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error || "Failed to register webhook")
            }

            setUrl("")
            setDescription("")
            onSuccess()
            onClose()
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Register Webhook Endpoint</DialogTitle>
                    <DialogDescription>
                        Add an HTTP POST URL to receive webhook event payloads from CloudVault.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                    {error && (
                        <div className="p-3 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md">
                            {error}
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label htmlFor="url">Payload URL</Label>
                        <Input
                            id="url"
                            placeholder="https://example.com/api/webhooks"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="desc">Description (Optional)</Label>
                        <Input
                            id="desc"
                            placeholder="Production notification handler"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>Subscribe Events</Label>
                        <div className="grid grid-cols-2 gap-2 pt-1">
                            {AVAILABLE_EVENTS.map((ev) => (
                                <label
                                    key={ev.id}
                                    className="flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-secondary text-xs"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedEvents.includes(ev.id)}
                                        onChange={() => toggleEvent(ev.id)}
                                        className="rounded border-gray-300"
                                    />
                                    <span>{ev.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <DialogFooter className="pt-2">
                        <Button type="button" variant="ghost" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                            {loading ? "Registering..." : "Create Webhook"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
