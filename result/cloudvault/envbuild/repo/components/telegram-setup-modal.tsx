"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Bot, MessageCircle, AlertTriangle, CheckCircle, ExternalLink } from "lucide-react"

interface TelegramSetupModalProps {
    isOpen: boolean
    onClose: () => void
    onSubmit: (botToken: string, chatId: string) => Promise<void>
    isLoading: boolean
}

export function TelegramSetupModal({ isOpen, onClose, onSubmit, isLoading }: TelegramSetupModalProps) {
    const [botToken, setBotToken] = useState("")
    const [chatId, setChatId] = useState("")
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        if (!botToken.trim() || !chatId.trim()) {
            setError("Both Bot Token and Chat ID are required")
            return
        }

        if (!botToken.includes(":")) {
            setError("Invalid bot token format. It should contain a colon (:)")
            return
        }

        if (!/^-?\d+$/.test(chatId.trim())) {
            setError("Chat ID should be a number (can be negative for groups)")
            return
        }

        try {
            await onSubmit(botToken.trim(), chatId.trim())
            setBotToken("")
            setChatId("")
        } catch (err: any) {
            setError(err.message || "Failed to setup Telegram integration")
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] p-0 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 shadow-2xl">
                <div className="flex flex-col h-full max-h-[90vh]">
                    {/* Header - Fixed */}
                    <div className="flex-shrink-0 p-6 pb-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-slate-100">
                                <Bot className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                                Setup Your Telegram Bot
                            </DialogTitle>
                            <DialogDescription className="text-slate-600 dark:text-slate-400">
                                Configure your personal Telegram bot to receive files through the CloudVault API
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    {/* Scrollable Content */}
                    <ScrollArea className="flex-1 p-6">
                        <div className="space-y-6">
                            {/* Important Notice */}
                            <Alert className="bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800">
                                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <AlertDescription className="space-y-2 text-amber-800 dark:text-amber-200">
                                    <p className="font-medium">Before proceeding, make sure you:</p>
                                    <ul className="list-disc list-inside space-y-1 text-sm">
                                        <li>Have created a Telegram bot via @BotFather</li>
                                        <li>Started your bot by sending /start command</li>
                                        <li>Have not blocked your bot</li>
                                        <li>Know your Chat ID (personal or group chat)</li>
                                    </ul>
                                </AlertDescription>
                            </Alert>

                            {/* Setup Instructions */}
                            <div className="grid md:grid-cols-2 gap-4">
                                <Card className="bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-sm flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                            <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                            Get Bot Token
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                                        <p>1. Message @BotFather on Telegram</p>
                                        <p>2. Send /newbot command</p>
                                        <p>3. Follow instructions to create bot</p>
                                        <p>4. Copy the bot token</p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full mt-2 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600"
                                            asChild
                                        >
                                            <a href="https://t.me/botfather" target="_blank" rel="noopener noreferrer">
                                                Open @BotFather <ExternalLink className="h-3 w-3 ml-1" />
                                            </a>
                                        </Button>
                                    </CardContent>
                                </Card>

                                <Card className="bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-sm flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                            <MessageCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                                            Get Chat ID
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                                        <p>1. Message @userinfobot on Telegram</p>
                                        <p>2. Send any message to get your Chat ID</p>
                                        <p>3. For groups: Add bot to group first</p>
                                        <p>4. Copy the Chat ID number</p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full mt-2 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600"
                                            asChild
                                        >
                                            <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer">
                                                Open @userinfobot <ExternalLink className="h-3 w-3 ml-1" />
                                            </a>
                                        </Button>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Form */}
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="botToken" className="text-slate-900 dark:text-slate-100 font-medium">
                                        Bot Token
                                    </Label>
                                    <Input
                                        id="botToken"
                                        type="password"
                                        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                                        value={botToken}
                                        onChange={(e) => setBotToken(e.target.value)}
                                        disabled={isLoading}
                                        className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 focus:border-blue-500 dark:focus:border-blue-400"
                                    />
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="chatId" className="text-slate-900 dark:text-slate-100 font-medium">
                                        Chat ID
                                    </Label>
                                    <Input
                                        id="chatId"
                                        type="text"
                                        placeholder="123456789 or -123456789"
                                        value={chatId}
                                        onChange={(e) => setChatId(e.target.value)}
                                        disabled={isLoading}
                                        className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 focus:border-blue-500 dark:focus:border-blue-400"
                                    />
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Your personal Chat ID or group Chat ID (negative number)
                                    </p>
                                </div>

                                {error && (
                                    <Alert
                                        variant="destructive"
                                        className="bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800"
                                    >
                                        <AlertDescription className="text-red-800 dark:text-red-200">{error}</AlertDescription>
                                    </Alert>
                                )}

                                {/* Success State */}
                                <Alert className="bg-green-50 border-green-200 dark:bg-green-950/50 dark:border-green-800">
                                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    <AlertDescription className="text-green-800 dark:text-green-200">
                                        <strong>What happens next:</strong> Your API key will be generated and linked to your Telegram bot.
                                        All files uploaded via your API will be sent to your specified chat.
                                    </AlertDescription>
                                </Alert>
                            </form>
                        </div>
                    </ScrollArea>

                    {/* Footer - Fixed */}
                    <div className="flex-shrink-0 p-6 pt-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onClose}
                                disabled={isLoading}
                                className="flex-1 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={isLoading || !botToken.trim() || !chatId.trim()}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors"
                                onClick={(e) => {
                                    e.preventDefault()
                                    const form = e.currentTarget.closest("div")?.parentElement?.querySelector("form")
                                    if (form) {
                                        const event = new Event("submit", { bubbles: true, cancelable: true })
                                        form.dispatchEvent(event)
                                    }
                                }}
                            >
                                {isLoading ? "Setting up..." : "Generate API Key"}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
