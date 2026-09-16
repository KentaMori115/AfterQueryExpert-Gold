"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TelegramSetupModal } from "@/components/telegram-setup-modal"
import type { UserProfile, ApiKeyData } from "@/lib/firestore"
import { Key, Copy, Check, Eye, EyeOff, Trash2, Bot, Edit2, Save, X } from "lucide-react"

interface ApiKeyManagementProps {
    userProfile: UserProfile | null
    apiKeys: ApiKeyData[]
    isLoading: boolean
    onTelegramSetup: (botToken: string, chatId: string) => Promise<void>
    onDeactivateApiKey: (keyId: string) => Promise<void>
    onUpdateApiKeyName: (keyId: string, newName: string) => Promise<void>
}

export function ApiKeyManagement({
    userProfile,
    apiKeys,
    isLoading,
    onTelegramSetup,
    onDeactivateApiKey,
    onUpdateApiKeyName,
}: ApiKeyManagementProps) {
    const [showApiKeys, setShowApiKeys] = useState<{ [key: string]: boolean }>({})
    const [copied, setCopied] = useState<string | null>(null)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingKey, setEditingKey] = useState<string | null>(null)
    const [editingName, setEditingName] = useState("")

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return "0 Bytes"
        const k = 1024
        const sizes = ["Bytes", "KB", "MB", "GB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
    }

    const copyApiKey = (apiKey: string, keyId: string) => {
        navigator.clipboard.writeText(apiKey)
        setCopied(keyId)
        setTimeout(() => setCopied(null), 2000)
    }

    const toggleApiKeyVisibility = (keyId: string) => {
        setShowApiKeys((prev) => ({ ...prev, [keyId]: !prev[keyId] }))
    }

    const startEditing = (keyId: string, currentName: string) => {
        setEditingKey(keyId)
        setEditingName(currentName)
    }

    const saveEdit = async (keyId: string) => {
        if (editingName.trim()) {
            await onUpdateApiKeyName(keyId, editingName.trim())
        }
        setEditingKey(null)
        setEditingName("")
    }

    const cancelEdit = () => {
        setEditingKey(null)
        setEditingName("")
    }

    const handleTelegramSetup = async (botToken: string, chatId: string) => {
        await onTelegramSetup(botToken, chatId)
        setIsModalOpen(false)
    }

    return (
        <>
            <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center">
                            <Key className="h-5 w-5 mr-2" />
                            API Keys ({apiKeys.length})
                        </span>
                    </CardTitle>
                    <CardDescription>
                        {userProfile
                            ? "Manage your API keys and monitor their usage"
                            : "Set up your Telegram bot to generate your first API key"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!userProfile ? (
                        <div className="text-center py-8">
                            <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <h3 className="text-lg font-semibold mb-2">Setup Your Telegram Bot</h3>
                            <p className="text-muted-foreground mb-4">Connect your Telegram bot to start using the CloudVault API</p>
                            <Button
                                onClick={() => setIsModalOpen(true)}
                                className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors"
                            >
                                <Bot className="h-4 w-4 mr-2" />
                                Setup Telegram Bot
                            </Button>
                        </div>
                    ) : (
                        <>
                            {/* API Keys List */}
                            {apiKeys.map((key) => (
                                <div key={key.id} className="border rounded-lg p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2">
                                            {editingKey === key.id ? (
                                                <div className="flex items-center space-x-2">
                                                    <Input
                                                        value={editingName}
                                                        onChange={(e) => setEditingName(e.target.value)}
                                                        className="w-48"
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") saveEdit(key.id)
                                                            if (e.key === "Escape") cancelEdit()
                                                        }}
                                                    />
                                                    <Button size="sm" variant="outline" onClick={() => saveEdit(key.id)}>
                                                        <Save className="h-3 w-3" />
                                                    </Button>
                                                    <Button size="sm" variant="outline" onClick={cancelEdit}>
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center space-x-2">
                                                    <div>
                                                        <h4 className="font-medium">{key.name}</h4>
                                                        <p className="text-sm text-muted-foreground">
                                                            Created: {new Date(key.createdAt).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => startEditing(key.id, key.name)}
                                                        className="h-6 w-6 p-0"
                                                    >
                                                        <Edit2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => onDeactivateApiKey(key.id)} disabled={isLoading}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>

                                    <div className="flex space-x-2">
                                        <Input
                                            type={showApiKeys[key.id] ? "text" : "password"}
                                            value={key.apiKey}
                                            readOnly
                                            className="font-mono text-sm"
                                        />
                                        <Button variant="outline" size="icon" onClick={() => toggleApiKeyVisibility(key.id)}>
                                            {showApiKeys[key.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </Button>
                                        <Button variant="outline" size="icon" onClick={() => copyApiKey(key.apiKey, key.id)}>
                                            {copied === key.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4 text-sm">
                                        <div>
                                            <p className="text-muted-foreground">Requests</p>
                                            <p className="font-medium">{key.totalRequests}</p>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground">Storage</p>
                                            <p className="font-medium">{formatBytes(key.totalStorage)}</p>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground">Bandwidth</p>
                                            <p className="font-medium">{formatBytes(key.totalBandwidth)}</p>
                                        </div>
                                    </div>

                                    {/* API Usage Examples */}
                                    <div className="mt-4 space-y-2">
                                        <Label className="text-sm font-medium">API Endpoint</Label>
                                        <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded text-sm font-mono">
                                            {typeof window !== "undefined" && `${window.location.origin}/api/upload`}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Add new API key button */}
                            <Button onClick={() => setIsModalOpen(true)} variant="outline" className="w-full" disabled={isLoading}>
                                <Key className="h-4 w-4 mr-2" />
                                Generate New API Key
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>

            <TelegramSetupModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleTelegramSetup}
                isLoading={isLoading}
            />
        </>
    )
}
