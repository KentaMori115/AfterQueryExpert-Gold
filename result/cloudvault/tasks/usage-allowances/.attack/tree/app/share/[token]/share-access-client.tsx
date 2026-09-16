"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Download, Lock, FileCheck, ShieldAlert } from "lucide-react"

interface ShareAccessClientProps {
    token: string
    requiresPassword: boolean
}

export function ShareAccessClient({ token, requiresPassword }: ShareAccessClientProps) {
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleDownload = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        setError(null)
        setLoading(true)

        try {
            const query = password ? `?password=${encodeURIComponent(password)}` : ""
            const res = await fetch(`/api/share/${token}${query}`)
            if (res.ok) {
                // Trigger file download stream
                const blob = await res.blob()
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = `file-${token.slice(0, 8)}`
                document.body.appendChild(a)
                a.click()
                a.remove()
            } else {
                const data = await res.json()
                setError(data.error || "Failed to download file")
            }
        } catch (err: any) {
            setError(err.message || "Network error occurred")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
            <Card className="w-full max-w-md shadow-lg border-indigo-100 dark:border-indigo-900">
                <CardHeader className="text-center pb-2">
                    <div className="mx-auto w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-2">
                        {requiresPassword ? <Lock className="h-6 w-6" /> : <FileCheck className="h-6 w-6" />}
                    </div>
                    <CardTitle className="text-2xl font-bold">CloudVault Public Download</CardTitle>
                    <CardDescription>
                        {requiresPassword
                            ? "This file is password protected. Enter password to unlock."
                            : "Your requested file is ready for secure download."}
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4 pt-2">
                    {error && (
                        <div className="p-3 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {requiresPassword ? (
                        <form onSubmit={handleDownload} className="space-y-3">
                            <Input
                                type="password"
                                placeholder="Enter Share Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                            <Button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                                {loading ? "Decrypting..." : "Unlock & Download"}
                            </Button>
                        </form>
                    ) : (
                        <Button onClick={() => handleDownload()} disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-11 text-base">
                            <Download className="h-5 w-5 mr-2" />
                            {loading ? "Preparing Stream..." : "Download File"}
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
