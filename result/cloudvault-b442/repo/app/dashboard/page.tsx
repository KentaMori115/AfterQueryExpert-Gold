"use client"

import { useState, useEffect } from "react"
import { getAuthInstance } from "@/lib/firebase"
import { signOut } from "firebase/auth"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { ApiKeyManagement } from "@/components/dashboard/api-key-management"
import { TestApi } from "@/components/dashboard/test-api"
import { BotStatus } from "@/components/dashboard/bot-status"
import { FileExplorer } from "@/components/dashboard/file-explorer"
import { DragDropUploader } from "@/components/dashboard/drag-drop-uploader"
import { AnalyticsCharts } from "@/components/dashboard/analytics-charts"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    getUserProfile,
    getUserApiKeys,
    getUserUsageStats,
    testTelegramBot,
    type UserProfile,
    type ApiKeyData,
} from "@/lib/firestore"
import { Database, LogOut, BookOpen, LayoutDashboard, FolderKanban, KeyRound, Terminal } from "lucide-react"
import Link from "next/link"
import { motion } from "framer-motion"

export default function DashboardPage() {
    const [user, setUser] = useState<any>(null)
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
    const [apiKeys, setApiKeys] = useState<ApiKeyData[]>([])
    const [usageStats, setUsageStats] = useState({ totalRequests: 0, totalStorage: 0, totalBandwidth: 0 })
    const [isLoading, setIsLoading] = useState(false)
    const [activeTab, setActiveTab] = useState("overview")
    const router = useRouter()

    useEffect(() => {
        const auth = getAuthInstance()
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            if (user) {
                setUser(user)
                await loadUserData(user.uid)
            } else {
                router.push("/")
            }
        })

        return () => unsubscribe()
    }, [router])

    const loadUserData = async (userId: string) => {
        try {
            const [profile, keys, stats] = await Promise.all([
                getUserProfile(userId),
                getUserApiKeys(userId),
                getUserUsageStats(userId),
            ])

            setUserProfile(profile)
            setApiKeys(keys)
            setUsageStats(stats)
        } catch (error) {
            console.error("Error loading user data:", error)
        }
    }

    const handleSignOut = async () => {
        try {
            await signOut(getAuthInstance())
            router.push("/")
        } catch (error) {
            console.error("Error signing out:", error)
        }
    }

    const handleTelegramSetup = async (botToken: string, chatId: string) => {
        if (!user) return

        setIsLoading(true)
        try {
            console.log("Testing Telegram bot...")
            const botWorks = await testTelegramBot(botToken, chatId)

            if (!botWorks) {
                throw new Error(
                    "Unable to send message to your Telegram bot. Please check your bot token and chat ID, and make sure you've started the bot.",
                )
            }

            const idToken = await user.getIdToken()

            const response = await fetch("/api/generateApiKey", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    botToken,
                    chatId,
                    keyName: "Default API Key",
                }),
            })

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.message || "Failed to generate API key")
            }

            await loadUserData(user.uid)
        } catch (error) {
            console.error("Error setting up Telegram:", error)
            throw error
        } finally {
            setIsLoading(false)
        }
    }

    const deactivateApiKey = async (keyId: string) => {
        if (!user) return

        setIsLoading(true)
        try {
            const idToken = await user.getIdToken()

            const response = await fetch(`/api/apiKeys/${keyId}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            })

            if (!response.ok) {
                throw new Error("Failed to deactivate API key")
            }

            await loadUserData(user.uid)
        } catch (error) {
            console.error("Error deactivating API key:", error)
        } finally {
            setIsLoading(false)
        }
    }

    const updateApiKeyName = async (keyId: string, newName: string) => {
        if (!user) return

        setIsLoading(true)
        try {
            const idToken = await user.getIdToken()

            const response = await fetch(`/api/apiKeys/${keyId}/name`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ name: newName }),
            })

            if (!response.ok) {
                throw new Error("Failed to update API key name")
            }

            await loadUserData(user.uid)
        } catch (error) {
            console.error("Error updating API key name:", error)
        } finally {
            setIsLoading(false)
        }
    }

    if (!user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p>Loading developer console...</p>
                </div>
            </div>
        )
    }

    return (
        <div 
            className="min-h-screen bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url('/Photo by Eva Bronzini on Pexels.jpg')` }}
        >
            <div className="min-h-screen bg-slate-50/85 dark:bg-slate-950/90 backdrop-blur-sm">
            <ThemeToggle />

            {/* Top Navigation */}
            <nav className="border-b border-white/20 backdrop-blur-sm sticky top-0 z-30 bg-white/40 dark:bg-slate-950/40">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <Link href="/dashboard" className="flex items-center space-x-3">
                            <div className="p-1 bg-white/10 dark:bg-slate-900/10 rounded-lg">
                                <img src="/facvicon.png" alt="CloudVault Logo" className="h-8 w-8 object-contain" />
                            </div>
                            <span className="text-2xl font-extrabold tracking-tight">
                                <span className="text-slate-900 dark:text-white">Cloud</span>
                                <span className="text-indigo-600 dark:text-indigo-400">Vault</span>
                            </span>
                        </Link>
                        <div className="flex items-center space-x-4">
                            <Link href="/docs">
                                <Button variant="outline" size="sm">
                                    <BookOpen className="h-4 w-4 mr-2" />
                                    Documentation
                                </Button>
                            </Link>
                            <span className="text-xs text-muted-foreground hidden sm:inline">{user.email}</span>
                            <Button variant="outline" size="sm" onClick={handleSignOut}>
                                <LogOut className="h-4 w-4 mr-2" />
                                Sign Out
                            </Button>
                        </div>
                    </div>
                </div>
            </nav>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold mb-1">Developer Console</h1>
                        <p className="text-muted-foreground text-sm">
                            Manage files, generate API keys, and monitor storage bandwidth metrics
                        </p>
                    </div>
                </div>

                {/* Dashboard Navigation Tabs */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                    <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full max-w-2xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-md p-1 border border-slate-200 dark:border-slate-800 rounded-xl relative">
                        <TabsTrigger 
                            value="overview" 
                            className="relative flex items-center justify-center gap-2 text-xs md:text-sm z-10 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground dark:data-[state=active]:text-white transition-colors duration-200"
                        >
                            {activeTab === "overview" && (
                                <motion.div
                                    layoutId="active-dashboard-tab"
                                    className="absolute inset-0 bg-white dark:bg-slate-950 rounded-lg shadow-sm -z-10"
                                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                />
                            )}
                            <LayoutDashboard className="h-4 w-4" /> Overview
                        </TabsTrigger>
                        <TabsTrigger 
                            value="files" 
                            className="relative flex items-center justify-center gap-2 text-xs md:text-sm z-10 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground dark:data-[state=active]:text-white transition-colors duration-200"
                        >
                            {activeTab === "files" && (
                                <motion.div
                                    layoutId="active-dashboard-tab"
                                    className="absolute inset-0 bg-white dark:bg-slate-950 rounded-lg shadow-sm -z-10"
                                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                />
                            )}
                            <FolderKanban className="h-4 w-4" /> File Manager
                        </TabsTrigger>
                        <TabsTrigger 
                            value="apikeys" 
                            className="relative flex items-center justify-center gap-2 text-xs md:text-sm z-10 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground dark:data-[state=active]:text-white transition-colors duration-200"
                        >
                            {activeTab === "apikeys" && (
                                <motion.div
                                    layoutId="active-dashboard-tab"
                                    className="absolute inset-0 bg-white dark:bg-slate-950 rounded-lg shadow-sm -z-10"
                                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                />
                            )}
                            <KeyRound className="h-4 w-4" /> API Keys
                        </TabsTrigger>
                        <TabsTrigger 
                            value="console" 
                            className="relative flex items-center justify-center gap-2 text-xs md:text-sm z-10 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground dark:data-[state=active]:text-white transition-colors duration-200"
                        >
                            {activeTab === "console" && (
                                <motion.div
                                    layoutId="active-dashboard-tab"
                                    className="absolute inset-0 bg-white dark:bg-slate-950 rounded-lg shadow-sm -z-10"
                                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                />
                            )}
                            <Terminal className="h-4 w-4" /> API Console
                        </TabsTrigger>
                    </TabsList>

                    {/* Overview Tab */}
                    <TabsContent value="overview" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                        <motion.div
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                            className="space-y-6"
                        >
                            <StatsCards usageStats={usageStats} />
                            <div className="grid lg:grid-cols-3 gap-6">
                                <div className="lg:col-span-2">
                                    <AnalyticsCharts user={user} />
                                </div>
                                <div>
                                    <BotStatus userProfile={userProfile} />
                                </div>
                            </div>
                        </motion.div>
                    </TabsContent>

                    {/* File Manager Tab */}
                    <TabsContent value="files" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                        <motion.div
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                            className="space-y-6"
                        >
                            <DragDropUploader
                                apiKeys={apiKeys}
                                onUploadSuccess={() => loadUserData(user.uid)}
                            />
                            <FileExplorer
                                user={user}
                                onFileDeleted={() => loadUserData(user.uid)}
                            />
                        </motion.div>
                    </TabsContent>

                    {/* API Keys Tab */}
                    <TabsContent value="apikeys" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                        <motion.div
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                            className="space-y-6"
                        >
                            <ApiKeyManagement
                                userProfile={userProfile}
                                apiKeys={apiKeys}
                                isLoading={isLoading}
                                onTelegramSetup={handleTelegramSetup}
                                onDeactivateApiKey={deactivateApiKey}
                                onUpdateApiKeyName={updateApiKeyName}
                            />
                            <BotStatus userProfile={userProfile} />
                        </motion.div>
                    </TabsContent>

                    {/* Console Tab */}
                    <TabsContent value="console" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                        <motion.div
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                            className="space-y-6"
                        >
                            <TestApi
                                apiKeys={apiKeys}
                                isLoading={isLoading}
                                onLoadUserData={() => loadUserData(user.uid)}
                            />
                        </motion.div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    </div>
    )
}
