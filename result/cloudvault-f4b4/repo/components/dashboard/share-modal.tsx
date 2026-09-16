"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Share2, Lock, Copy, Check } from "lucide-react"

interface ShareModalProps {
    fileId: string | null
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    apiKey: string
}

export function ShareModal({ fileId, isOpen, onClose, onSuccess, apiKey }: ShareModalProps) {
    const [password, setPassword] = useState("")
    const [maxDownloads, setMaxDownloads] = useState("")
    const [expiresInHours, setExpiresInHours] = useState("")
    const [loading, setLoading] = useState(false)
    const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    const handleCreateShare = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!fileId) return
        setLoading(true)

        try {
            const res = await fetch("/api/shares", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    fileId,
                    password: password || undefined,
                    maxDownloads: maxDownloads ? Number(maxDownloads) : undefined,
                    expiresInHours: expiresInHours ? Number(expiresInHours) : undefined,
                }),
            })

            const data = await res.json()
            if (res.ok && data.share) {
                const url = `${window.location.origin}/api/share/${data.share.token}`
                setGeneratedUrl(url)
                onSuccess()
            } else {
                alert(data.error || "Failed to create share link")
            }
        } catch (err) {
            alert("An error occurred creating share link")
        } finally {
            setLoading(false)
        }
    }

    const copyToClipboard = () => {
        if (generatedUrl) {
            navigator.clipboard.writeText(generatedUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Share2 className="h-5 w-5 text-indigo-500" />
                        Create Public Share Link
                    </DialogTitle>
                    <DialogDescription>
                        Configure security controls for file <code className="bg-secondary px-1 rounded">{fileId}</code>.
                    </DialogDescription>
                </DialogHeader>

                {generatedUrl ? (
                    <div className="space-y-4 py-3">
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-900 text-xs">
                            <p className="font-semibold mb-1">Public Share Link Created!</p>
                            <p className="text-slate-600">Anyone with this link can download the file according to your security settings.</p>
                        </div>
                        <div className="flex gap-2">
                            <Input value={generatedUrl} readOnly className="font-mono text-xs" />
                            <Button onClick={copyToClipboard} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                        </div>
                        <DialogFooter className="pt-2">
                            <Button onClick={onClose}>Done</Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <form onSubmit={handleCreateShare} className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="pass" className="flex items-center gap-1.5 text-xs">
                                <Lock className="h-3.5 w-3.5" /> Optional Protection Password
                            </Label>
                            <Input
                                id="pass"
                                type="password"
                                placeholder="Leave blank for no password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="maxDl" className="text-xs">Max Downloads</Label>
                                <Input
                                    id="maxDl"
                                    type="number"
                                    placeholder="e.g. 10"
                                    value={maxDownloads}
                                    onChange={(e) => setMaxDownloads(e.target.value)}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="expiry" className="text-xs">Expires In (Hours)</Label>
                                <Input
                                    id="expiry"
                                    type="number"
                                    placeholder="e.g. 24"
                                    value={expiresInHours}
                                    onChange={(e) => setExpiresInHours(e.target.value)}
                                />
                            </div>
                        </div>

                        <DialogFooter className="pt-2">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                                {loading ? "Generating..." : "Generate Share Link"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    )
}
