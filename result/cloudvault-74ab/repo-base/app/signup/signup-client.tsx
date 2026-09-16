"use client"

import type React from "react"
import { useState } from "react"
import { getAuthInstance } from "@/lib/firebase"
import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "firebase/auth"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ThemeToggle } from "@/components/theme-toggle"
import { Database, Shield, Zap, Cloud } from "lucide-react"
import Link from "next/link"

export default function SignupClient() {
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const router = useRouter()

    const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setError(null)
        const auth = getAuthInstance()

        if (password !== confirmPassword) {
            setError("Passwords don't match")
            return
        }

        if (password.length < 6) {
            setError("Password must be at least 6 characters")
            return
        }

        setIsLoading(true)

        try {
            await createUserWithEmailAndPassword(auth, email, password)
            router.push("/dashboard")
        } catch (err: any) {
            setError(err.message)
        } finally {
            setIsLoading(false)
        }
    }

    const handleGoogleSignIn = async () => {
        setError(null)
        setIsLoading(true)
        const provider = new GoogleAuthProvider()
        const auth = getAuthInstance()

        try {
            await signInWithPopup(auth, provider)
            router.push("/dashboard")
        } catch (err: any) {
            setError(err.message)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">

            {/* Floating Elements */}
            <div className="absolute top-20 left-20 w-72 h-72 bg-blue-400/20 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-20 right-20 w-96 h-96 bg-indigo-400/20 rounded-full blur-3xl animate-pulse delay-1000" />

            <ThemeToggle />

            <div className="relative z-10 w-full max-w-6xl mx-auto grid lg:grid-cols-2 gap-8 items-center">
                {/* Left Side - Branding */}
                <div className="hidden lg:block space-y-8">
                    <div className="space-y-4">
                        <div className="flex items-center space-x-3">
                            <div className="p-1 bg-white/10 dark:bg-slate-900/10 rounded-xl">
                                <img src="/facvicon.png" alt="CloudVault Logo" className="h-12 w-12 object-contain" />
                            </div>
                            <h1 className="text-4xl font-extrabold tracking-tight">
                                <span className="text-slate-900 dark:text-white">Cloud</span>
                                <span className="text-indigo-600 dark:text-indigo-400">Vault</span>
                            </h1>
                        </div>
                        <p className="text-xl text-muted-foreground">
                            Join thousands of developers using our secure cloud storage API for their applications.
                        </p>
                    </div>

                    <div className="grid gap-6">
                        <div className="flex items-start space-x-4">
                            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                                <Shield className="h-6 w-6 text-green-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg">Free Tier Available</h3>
                                <p className="text-muted-foreground">Start with 1GB free storage and 10,000 API calls</p>
                            </div>
                        </div>

                        <div className="flex items-start space-x-4">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                                <Zap className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg">Instant Setup</h3>
                                <p className="text-muted-foreground">Get your API key immediately after registration</p>
                            </div>
                        </div>

                        <div className="flex items-start space-x-4">
                            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                                <Cloud className="h-6 w-6 text-purple-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg">Global CDN</h3>
                                <p className="text-muted-foreground">Fast access from anywhere in the world</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Side - Signup Form */}
                <div className="flex items-center justify-center">
                    <Card className="w-full max-w-md backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20 shadow-2xl">
                        <CardHeader className="space-y-1 text-center">
                            <div className="flex justify-center mb-4 lg:hidden">
                                <div className="p-1 bg-white/10 dark:bg-slate-900/10 rounded-xl">
                                    <img src="/facvicon.png" alt="CloudVault Logo" className="h-12 w-12 object-contain" />
                                </div>
                            </div>
                            <CardTitle className="text-2xl font-bold">Create your account</CardTitle>
                            <CardDescription>Start building with CloudVault API today</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <form onSubmit={handleSignup} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email address</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="developer@company.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className="bg-white/50 dark:bg-slate-800/50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">Password</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="••••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        className="bg-white/50 dark:bg-slate-800/50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                                    <Input
                                        id="confirmPassword"
                                        type="password"
                                        placeholder="••••••••••"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                        className="bg-white/50 dark:bg-slate-800/50"
                                    />
                                </div>

                                {error && (
                                    <Alert variant="destructive">
                                        <AlertDescription>{error}</AlertDescription>
                                    </Alert>
                                )}

                                <Button
                                     type="submit"
                                     className="w-full bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors"
                                     disabled={isLoading}
                                 >
                                    {isLoading ? "Creating account..." : "Create account"}
                                </Button>
                            </form>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                                </div>
                            </div>

                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleGoogleSignIn}
                                disabled={isLoading}
                                className="w-full bg-white/50 dark:bg-slate-800/50"
                            >
                                <img src="/google.png" alt="Google Logo" className="mr-2 h-4 w-4 object-contain" />
                                Google
                            </Button>

                            <div className="text-center text-sm text-muted-foreground">
                                Already have an account?{" "}
                                <Link href="/" className="text-blue-600 hover:underline font-medium">
                                    Sign in
                                </Link>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
