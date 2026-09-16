"use client"

import { useState, useEffect } from "react"
import { WorkspaceMember } from "@/lib/workspace-rbac"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, UserPlus, Shield, Trash2, Mail } from "lucide-react"

interface TeamManagementProps {
    workspaceId: string
    onOpenInviteModal: () => void
    apiKey: string
}

export function TeamManagement({ workspaceId, onOpenInviteModal, apiKey }: TeamManagementProps) {
    const [members, setMembers] = useState<WorkspaceMember[]>([])
    const [loading, setLoading] = useState(false)

    const fetchMembers = async () => {
        if (!workspaceId) return
        setLoading(true)
        try {
            const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            })
            if (res.ok) {
                const data = await res.json()
                setMembers(data.members || [])
            }
        } catch (err) {
            console.error("Failed to load workspace members:", err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchMembers()
    }, [workspaceId, apiKey])

    const handleRemove = async (memberId: string) => {
        if (!confirm("Remove this member from workspace?")) return
        try {
            const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${apiKey}` },
            })
            if (res.ok) fetchMembers()
        } catch (err) {
            alert("Failed to remove member")
        }
    }

    return (
        <Card className="w-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <Users className="h-5 w-5 text-indigo-500" />
                        Team Members & Permissions
                    </CardTitle>
                    <CardDescription>
                        Manage role-based access control (Owner, Admin, Editor, Viewer) for this workspace.
                    </CardDescription>
                </div>
                <Button size="sm" onClick={onOpenInviteModal} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                    <UserPlus className="h-4 w-4 mr-1" /> Invite Member
                </Button>
            </CardHeader>

            <CardContent>
                {loading ? (
                    <div className="text-center py-8 text-xs text-slate-500">Loading members...</div>
                ) : members.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 border border-dashed rounded-lg text-xs">
                        No team members invited yet.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {members.map((m) => (
                            <div
                                key={m.id}
                                className="flex items-center justify-between p-3 border rounded-lg bg-card text-xs"
                            >
                                <div className="flex items-center gap-3">
                                    <Mail className="h-4 w-4 text-slate-400" />
                                    <div>
                                        <p className="font-semibold text-foreground">{m.email || m.userId}</p>
                                        <p className="text-[11px] text-slate-400">Joined: {new Date(m.joinedAt).toLocaleDateString()}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                                        <Shield className="h-3 w-3 mr-1" /> {m.role.toUpperCase()}
                                    </span>
                                    {m.role !== "owner" && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleRemove(m.id)}
                                            className="h-7 w-7 text-rose-600 hover:bg-rose-50"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
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
