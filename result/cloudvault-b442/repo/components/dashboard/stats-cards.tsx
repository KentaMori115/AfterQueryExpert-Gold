"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart3, Database, Activity } from "lucide-react"
import { formatBytes } from "@/lib/file-utils"

interface StatsCardsProps {
    usageStats: {
        totalRequests: number
        totalStorage: number
        totalBandwidth: number
    }
}

export function StatsCards({ usageStats }: StatsCardsProps) {

    return (
        <div className="grid md:grid-cols-3 gap-6 mb-8">
            <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">API Requests</CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{usageStats.totalRequests.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">Total requests</p>
                </CardContent>
            </Card>

            <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Storage Used</CardTitle>
                    <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatBytes(usageStats.totalStorage)}</div>
                    <p className="text-xs text-muted-foreground">Total storage</p>
                </CardContent>
            </Card>

            <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Bandwidth</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatBytes(usageStats.totalBandwidth)}</div>
                    <p className="text-xs text-muted-foreground">Total bandwidth</p>
                </CardContent>
            </Card>
        </div>
    )
}
