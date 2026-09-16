"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WorkspaceRole } from "@/lib/workspace-rbac"

interface InviteMemberModalProps {
    workspaceId: string
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    apiKey: string
}

export function InviteMemberModal({ workspaceId, isOpen, onClose, onSuccess, apiKey }: InviteMemberModalProps) {
    const [email, setEmail] = useState("")
    const [role, setRole] = useState<WorkspaceRole>("editor")
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!email || !workspaceId) return
        setLoading(true)

        try {
            const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({ email, role }),
            })
            if (res.ok) {
                setEmail("")
                onSuccess()
                onClose()
            } else {
                const data = await res.json()
                alert(data.error || "Failed to invite member")
            }
        } catch (err) {
            alert("Error sending invitation")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Invite Team Member</DialogTitle>
                    <DialogDescription>Send an invite to collaborate in this workspace.</DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="email">Email Address</Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="colleague@company.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="role">Workspace Role</Label>
                        <select
                            id="role"
                            value={role}
                            onChange={(e) => setRole(e.target.value as WorkspaceRole)}
                            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        >
                            <option value="admin">Admin (Full Control)</option>
                            <option value="editor">Editor (Read & Write Files)</option>
                            <option value="viewer">Viewer (Read Only)</option>
                        </select>
                    </div>

                    <DialogFooter className="pt-2">
                        <Button type="button" variant="ghost" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                            {loading ? "Sending..." : "Send Invite"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
