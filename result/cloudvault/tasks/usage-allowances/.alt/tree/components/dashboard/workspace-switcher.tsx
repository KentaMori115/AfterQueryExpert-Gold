"use client"

import { useWorkspace } from "./workspace-context"
import { Button } from "@/components/ui/button"
import { Users, Plus, Check, ChevronDown } from "lucide-react"

interface WorkspaceSwitcherProps {
    onOpenCreateModal: () => void
}

export function WorkspaceSwitcher({ onOpenCreateModal }: WorkspaceSwitcherProps) {
    const { activeWorkspace, setActiveWorkspace, workspaces } = useWorkspace()

    return (
        <div className="relative inline-block text-left">
            <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-semibold">
                    <Users className="h-3.5 w-3.5 text-indigo-500" />
                    <span>{activeWorkspace ? activeWorkspace.name : "Personal Space"}</span>
                    <ChevronDown className="h-3 w-3 opacity-50 ml-1" />
                </Button>
                <Button variant="ghost" size="icon" onClick={onOpenCreateModal} className="h-8 w-8" title="Create Workspace">
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
