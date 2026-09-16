"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { Workspace } from "@/lib/workspace-rbac"

interface WorkspaceContextType {
    activeWorkspace: Workspace | null
    setActiveWorkspace: (ws: Workspace | null) => void
    workspaces: Workspace[]
    refreshWorkspaces: () => void
}

const WorkspaceContext = createContext<WorkspaceContextType>({
    activeWorkspace: null,
    setActiveWorkspace: () => {},
    workspaces: [],
    refreshWorkspaces: () => {},
})

export function WorkspaceProvider({ children, apiKey }: { children: ReactNode; apiKey: string }) {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null)

    const refreshWorkspaces = async () => {
        if (!apiKey) return
        try {
            const res = await fetch("/api/workspaces", {
                headers: { Authorization: `Bearer ${apiKey}` },
            })
            if (res.ok) {
                const data = await res.json()
                setWorkspaces(data.workspaces || [])
                if (!activeWorkspace && data.workspaces?.length > 0) {
                    setActiveWorkspace(data.workspaces[0])
                }
            }
        } catch (err) {
            console.error("Failed to load workspaces context:", err)
        }
    }

    useEffect(() => {
        refreshWorkspaces()
    }, [apiKey])

    return (
        <WorkspaceContext.Provider
            value={{ activeWorkspace, setActiveWorkspace, workspaces, refreshWorkspaces }}
        >
            {children}
        </WorkspaceContext.Provider>
    )
}

export function useWorkspace() {
    return useContext(WorkspaceContext)
}
