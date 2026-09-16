"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { UserProfile } from "@/lib/firestore"
import { Bot } from "lucide-react"

interface BotStatusProps {
    userProfile: UserProfile | null
}

export function BotStatus({ userProfile }: BotStatusProps) {
    if (!userProfile) return null

    return (
        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
            <CardHeader>
                <CardTitle className="flex items-center">
                    <Bot className="h-5 w-5 mr-2" />
                    Telegram Bot Status
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-center space-x-2 text-sm">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span>Connected to Chat ID: {userProfile.chatId}</span>
                </div>
            </CardContent>
        </Card>
    )
}
