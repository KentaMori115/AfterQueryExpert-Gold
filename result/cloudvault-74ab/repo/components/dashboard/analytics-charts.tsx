"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BarChart3, TrendingUp, HardDrive, ArrowUpRight, ArrowDownRight, RefreshCw } from "lucide-react"

interface AnalyticsChartsProps {
    user: any
}

export function AnalyticsCharts({ user }: AnalyticsChartsProps) {
    const [days, setDays] = useState(7)
    const [isLoading, setIsLoading] = useState(true)
    const [analyticsData, setAnalyticsData] = useState<any>(null)

    const fetchAnalytics = useCallback(async () => {
        if (!user) return
        setIsLoading(true)
        try {
            const idToken = await user.getIdToken()
            const res = await fetch(`/api/dashboard/analytics?days=${days}`, {
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            })

            if (res.ok) {
                const data = await res.json()
                if (data.success) {
                    setAnalyticsData(data.data)
                }
            }
        } catch (err) {
            console.error("Error loading analytics:", err)
        } finally {
            setIsLoading(false)
        }
    }, [user, days])

    useEffect(() => {
        fetchAnalytics()
    }, [fetchAnalytics])

    const formatMB = (bytes: number) => {
        return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    }

    const timeline = analyticsData?.timeline || []
    const maxBandwidth = Math.max(...timeline.map((t: any) => t.bandwidth || 0), 1)

    return (
        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20 shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-indigo-600" /> Storage & Traffic Analytics
                    </CardTitle>
                    <CardDescription>Visual timeline of bandwidth transfer and operation counts</CardDescription>
                </div>
                <div className="flex items-center space-x-2">
                    {[7, 14, 30].map((d) => (
                        <Button
                            key={d}
                            variant={days === d ? "default" : "outline"}
                            size="sm"
                            onClick={() => setDays(d)}
                            className="h-7 text-xs px-2.5 rounded-md"
                        >
                            {d}D
                        </Button>
                    ))}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={fetchAnalytics}
                        disabled={isLoading}
                        className="h-7 w-7"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="space-y-6">
                {/* Summary Badges */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800">
                        <p className="text-xs text-muted-foreground">Active Storage Files</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                            {analyticsData?.totals?.activeFilesCount ?? 0}
                        </p>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800">
                        <p className="text-xs text-muted-foreground">Total API Operations</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                            {analyticsData?.totals?.totalRequests ?? 0}
                        </p>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-800">
                        <p className="text-xs text-muted-foreground">Cumulative Bandwidth</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                            {formatMB(analyticsData?.totals?.totalBandwidth ?? 0)}
                        </p>
                    </div>
                </div>

                {/* Visual Bar Chart for Bandwidth */}
                <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-medium text-slate-600 dark:text-slate-400">
                        <span>Daily Bandwidth Activity ({days} Days)</span>
                        <span className="flex items-center gap-3">
                            <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Uploads
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" /> Downloads
                            </span>
                        </span>
                    </div>

                    {isLoading ? (
                        <div className="h-44 flex items-center justify-center text-muted-foreground text-xs">
                            <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading chart data...
                        </div>
                    ) : timeline.length === 0 ? (
                        <div className="h-44 flex items-center justify-center text-muted-foreground text-xs border border-dashed rounded-lg">
                            No analytics data recorded for this timeframe yet
                        </div>
                    ) : (
                        <div className="h-44 flex items-end justify-between gap-2 pt-6 pb-2 px-2 bg-slate-50/50 dark:bg-slate-950/50 rounded-xl border border-slate-200 dark:border-slate-800">
                            {timeline.map((item: any) => {
                                const heightPercent = Math.max(10, Math.min(100, (item.bandwidth / maxBandwidth) * 100))
                                const dateLabel = item.date.slice(5) // MM-DD

                                return (
                                    <div key={item.date} className="flex-1 flex flex-col items-center h-full justify-end group">
                                        {/* Bar */}
                                        <div className="w-full max-w-[28px] bg-slate-200 dark:bg-slate-800 rounded-t relative overflow-hidden flex flex-col justify-end transition-all duration-300 group-hover:brightness-110" style={{ height: `${heightPercent}%` }}>
                                            <div
                                                className="bg-indigo-500 w-full transition-all duration-300"
                                                style={{ height: `${item.downloads > 0 ? (item.downloads / (item.uploads + item.downloads || 1)) * 100 : 0}%` }}
                                            />
                                            <div
                                                className="bg-blue-500 w-full transition-all duration-300"
                                                style={{ height: `${item.uploads > 0 ? (item.uploads / (item.uploads + item.downloads || 1)) * 100 : 0}%` }}
                                            />
                                        </div>

                                        {/* Tooltip on hover */}
                                        <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-slate-900 text-white text-[10px] py-1 px-2 rounded shadow-md pointer-events-none transition-opacity whitespace-nowrap z-20 font-mono">
                                            {item.date}: {formatMB(item.bandwidth)} ({item.uploads} up, {item.downloads} down)
                                        </div>

                                        {/* Date label */}
                                        <span className="text-[10px] text-muted-foreground mt-2 font-mono">{dateLabel}</span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
