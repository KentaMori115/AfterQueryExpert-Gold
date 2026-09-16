"use client"

import { useState } from "react"
import { ShareConfig } from "@/lib/share-manager"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Share2, Lock, Copy, Check, Trash2, BarChart2, Clock, ShieldCheck } from "lucide-react"

interface ShareLinkTableProps {
    shares: ShareConfig[]
    onRefresh: () => void
    onOpenAnalytics: (shareId: string) => void
    apiKey: string
}

export function ShareLinkTable({ shares, onRefresh, onOpenAnalytics, apiKey }: ShareLinkTableProps) {
    const [copiedToken, setCopiedToken] = useState<string | null>(null)
    const [revokingId, setRevokingId] = useState<string | null>(null)

    const handleCopy = (token: string) => {
        const url = `${window.location.origin}/api/share/${token}`
        navigator.clipboard.writeText(url)
        setCopiedToken(token)
        setTimeout(() => setCopiedToken(null), 2000)
    }

    const handleRevoke = async (id: string) => {
        if (!confirm("Are you sure you want to revoke this public share link?")) return
        setRevokingId(id)
        try {
            const res = await fetch(`/api/shares/${id}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            })
            if (res.ok) {
                onRefresh()
            } else {
                alert("Failed to revoke share link")
            }
        } catch (err) {
            alert("Error revoking share link")
        } finally {
            setRevokingId(null)
        }
    }

    return (
        <Card className="w-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <Share2 className="h-5 w-5 text-indigo-500" />
                        Active Share Links
                    </CardTitle>
                    <CardDescription>
                        Manage secure public download links, passwords, download limits, and revocation.
                    </CardDescription>
                </div>
            </CardHeader>
            <CardContent>
                {shares.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                        <Share2 className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        <p className="font-medium">No Active Public Share Links</p>
                        <p className="text-xs text-slate-500">
                            Create custom share links directly from the File Explorer context menu.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {shares.map((s) => (
                            <div
                                key={s.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg hover:border-indigo-200 transition-colors bg-card gap-3 text-xs"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-semibold text-sm truncate max-w-xs">
                                            Token: {s.token.slice(0, 12)}...
                                        </span>
                                        {s.passwordHash && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">
                                                <Lock className="h-3 w-3 mr-1" /> Password Protected
                                            </span>
                                        )}
                                        {s.isActive ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">
                                                <ShieldCheck className="h-3 w-3 mr-1" /> Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-rose-100 text-rose-800">
                                                Revoked
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 text-slate-500">
                                        <span>File ID: <code className="bg-secondary px-1 rounded">{s.fileId}</code></span>
                                        <span>Downloads: <strong>{s.downloadsCount}</strong> {s.maxDownloads ? `/ ${s.maxDownloads}` : ""}</span>
                                        {s.expiresAt && (
                                            <span className="flex items-center text-amber-600">
                                                <Clock className="h-3 w-3 mr-1" /> Exp: {new Date(s.expiresAt).toLocaleDateString()}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 self-end sm:self-center">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleCopy(s.token)}
                                        className="h-8"
                                    >
                                        {copiedToken === s.token ? (
                                            <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                                        ) : (
                                            <Copy className="h-3.5 w-3.5 mr-1" />
                                        )}
                                        {copiedToken === s.token ? "Copied" : "Copy Link"}
                                    </Button>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onOpenAnalytics(s.id)}
                                        className="h-8"
                                    >
                                        <BarChart2 className="h-3.5 w-3.5 mr-1" /> Analytics
                                    </Button>

                                    {s.isActive && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleRevoke(s.id)}
                                            disabled={revokingId === s.id}
                                            className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
