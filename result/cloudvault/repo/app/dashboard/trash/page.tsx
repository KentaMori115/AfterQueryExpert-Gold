"use client"

import { useState, useEffect } from "react"
import { TrashExplorer } from "@/components/dashboard/trash-explorer"
import { TrashedItem } from "@/lib/version-trash"

export default function TrashPage() {
    const [items, setItems] = useState<TrashedItem[]>([])
    const [apiKey, setApiKey] = useState("")

    useEffect(() => {
        const storedKey = localStorage.getItem("cloudvault_api_key") || ""
        setApiKey(storedKey)
    }, [])

    const fetchTrash = async () => {
        if (!apiKey) return
        try {
            const res = await fetch("/api/trash", {
                headers: { Authorization: `Bearer ${apiKey}` },
            })
            if (res.ok) {
                const data = await res.json()
                setItems(data.trash || [])
            }
        } catch (err) {
            console.error("Failed to load trash:", err)
        }
    }

    useEffect(() => {
        fetchTrash()
    }, [apiKey])

    return (
        <div className="p-6 space-y-6">
            <TrashExplorer items={items} onRefresh={fetchTrash} apiKey={apiKey} />
        </div>
    )
}
