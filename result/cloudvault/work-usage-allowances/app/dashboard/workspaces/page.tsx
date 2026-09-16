"use client"

import { useState, useEffect } from "react"
import { TeamManagement } from "@/components/dashboard/team-management"
import { InviteMemberModal } from "@/components/dashboard/invite-member-modal"
import { useWorkspace } from "@/components/dashboard/workspace-context"

export default function WorkspacesPage() {
    const { activeWorkspace } = useWorkspace()
    const [isInviteOpen, setIsInviteOpen] = useState(false)
    const [apiKey, setApiKey] = useState("")

    useEffect(() => {
        const storedKey = localStorage.getItem("cloudvault_api_key") || ""
        setApiKey(storedKey)
    }, [])

    if (!activeWorkspace) {
        return (
            <div className="p-6 text-center text-sm text-slate-500">
                Select or create a workspace to manage team members.
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6">
            <TeamManagement
                workspaceId={activeWorkspace.id}
                onOpenInviteModal={() => setIsInviteOpen(true)}
                apiKey={apiKey}
            />

            <InviteMemberModal
                workspaceId={activeWorkspace.id}
                isOpen={isInviteOpen}
                onClose={() => setIsInviteOpen(false)}
                onSuccess={() => setIsInviteOpen(false)}
                apiKey={apiKey}
            />
        </div>
    )
}
