"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import { Database, Shield, Zap, Cloud, Code, Key, FileText, Users, ArrowRight, Copy, Check } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

export default function HomeClient() {
    const [copiedCode, setCopiedCode] = useState<string | null>(null)

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text)
        setCopiedCode(id)
        setTimeout(() => setCopiedCode(null), 2000)
    }

    const codeExamples = {
        upload: `// Upload a file
const response = await fetch('https://api.cloudvault.dev/v1/upload', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    filename: 'document.pdf',
    data: base64Data
  })
});

const result = await response.json();
console.log('File URL:', result.url);`,

        retrieve: `// Retrieve a file
const response = await fetch('https://api.cloudvault.dev/v1/files/FILE_ID', {
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY'
  }
});

const fileData = await response.json();
console.log('File info:', fileData);`,

        delete: `// Delete a file
const response = await fetch('https://api.cloudvault.dev/v1/files/FILE_ID', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY'
  }
});

console.log('File deleted:', response.ok);`,
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <ThemeToggle />

            {/* Navigation */}
            <nav className="relative z-10 border-b border-white/20 backdrop-blur-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <Link href="/home" className="flex items-center space-x-3">
                            <div className="p-1 bg-white/10 dark:bg-slate-900/10 rounded-lg">
                                <img src="/facvicon.png" alt="CloudVault Logo" className="h-8 w-8 object-contain" />
                            </div>
                            <span className="text-2xl font-extrabold tracking-tight">
                                <span className="text-slate-900 dark:text-white">Cloud</span>
                                <span className="text-indigo-600 dark:text-indigo-400">Vault</span>
                            </span>
                        </Link>
                        <div className="flex items-center space-x-4">
                            <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                                Documentation
                            </Link>
                            <Link href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                                Pricing
                            </Link>
                            <Link href="/">
                                <Button variant="outline">Sign In</Button>
                            </Link>
                            <Link href="/signup">
                                <Button className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors">
                                    Get Started
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="relative py-20 px-4">
                <div className="absolute top-20 left-20 w-72 h-72 bg-blue-400/20 rounded-full blur-3xl animate-pulse" />
                <div className="absolute bottom-20 right-20 w-96 h-96 bg-indigo-400/20 rounded-full blur-3xl animate-pulse delay-1000" />

                <div className="relative z-10 max-w-7xl mx-auto text-center">
                    <h1 className="text-5xl md:text-7xl font-bold mb-6">
                        <span className="text-indigo-600 dark:text-indigo-400">
                            Secure Cloud Storage
                        </span>
                        <br />
                        <span className="text-foreground">for Developers</span>
                    </h1>
                    <p className="text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
                        Simple, fast, and secure API for storing and retrieving files. Built for developers who need reliable cloud
                        storage without the complexity.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link href="/signup">
                            <Button
                                size="lg"
                                className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors"
                            >
                                Start Building <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                        <Button size="lg" variant="outline">
                            <FileText className="mr-2 h-4 w-4" />
                            View Documentation
                        </Button>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="py-20 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">Why Choose CloudVault?</h2>
                        <p className="text-xl text-muted-foreground">Everything you need for secure file storage</p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg w-fit">
                                    <Shield className="h-6 w-6 text-blue-600" />
                                </div>
                                <CardTitle>Enterprise Security</CardTitle>
                                <CardDescription>
                                    End-to-end encryption with API key authentication and secure data centers
                                </CardDescription>
                            </CardHeader>
                        </Card>

                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg w-fit">
                                    <Zap className="h-6 w-6 text-green-600" />
                                </div>
                                <CardTitle>Lightning Fast</CardTitle>
                                <CardDescription>Global CDN with edge caching for sub-100ms response times worldwide</CardDescription>
                            </CardHeader>
                        </Card>

                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg w-fit">
                                    <Code className="h-6 w-6 text-purple-600" />
                                </div>
                                <CardTitle>Developer First</CardTitle>
                                <CardDescription>RESTful API with SDKs for all major languages and comprehensive docs</CardDescription>
                            </CardHeader>
                        </Card>

                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg w-fit">
                                    <Cloud className="h-6 w-6 text-orange-600" />
                                </div>
                                <CardTitle>99.9% Uptime</CardTitle>
                                <CardDescription>Redundant infrastructure with automatic failover and data replication</CardDescription>
                            </CardHeader>
                        </Card>

                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg w-fit">
                                    <Key className="h-6 w-6 text-indigo-600" />
                                </div>
                                <CardTitle>Simple Authentication</CardTitle>
                                <CardDescription>Just add your API key to headers - no complex OAuth flows required</CardDescription>
                            </CardHeader>
                        </Card>

                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <div className="p-2 bg-pink-100 dark:bg-pink-900/30 rounded-lg w-fit">
                                    <Users className="h-6 w-6 text-pink-600" />
                                </div>
                                <CardTitle>Scalable Pricing</CardTitle>
                                <CardDescription>
                                    Start free and scale with usage-based pricing that grows with your app
                                </CardDescription>
                            </CardHeader>
                        </Card>
                    </div>
                </div>
            </section>

            {/* API Documentation Section */}
            <section id="docs" className="py-20 px-4 bg-white/50 dark:bg-slate-900/50">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">Quick Start Guide</h2>
                        <p className="text-xl text-muted-foreground">Get up and running in minutes</p>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-8">
                        {/* Upload Example */}
                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <CardTitle className="flex items-center justify-between">
                                    Upload Files
                                    <Button variant="ghost" size="icon" onClick={() => copyToClipboard(codeExamples.upload, "upload")}>
                                        {copiedCode === "upload" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                    </Button>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                    <code>{codeExamples.upload}</code>
                                </pre>
                            </CardContent>
                        </Card>

                        {/* Retrieve Example */}
                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <CardTitle className="flex items-center justify-between">
                                    Retrieve Files
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => copyToClipboard(codeExamples.retrieve, "retrieve")}
                                    >
                                        {copiedCode === "retrieve" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                    </Button>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                    <code>{codeExamples.retrieve}</code>
                                </pre>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="mt-8 text-center">
                        <Link href="/dashboard">
                            <Button
                                size="lg"
                                className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors"
                            >
                                Get Your API Key <Key className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            {/* <section id="pricing" className="py-20 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
                        <p className="text-xl text-muted-foreground">Start free, scale as you grow</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <CardTitle>Free</CardTitle>
                                <CardDescription>Perfect for getting started</CardDescription>
                                <div className="text-3xl font-bold">
                                    $0<span className="text-sm font-normal">/month</span>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <ul className="space-y-2 text-sm">
                                    <li>• 1GB storage</li>
                                    <li>• 10,000 API calls/month</li>
                                    <li>• Basic support</li>
                                    <li>• 99.9% uptime SLA</li>
                                </ul>
                                <Link href="/signup">
                                    <Button className="w-full bg-transparent" variant="outline">
                                        Get Started
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>

                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20 ring-2 ring-blue-500">
                            <CardHeader>
                                <CardTitle>Pro</CardTitle>
                                <CardDescription>For growing applications</CardDescription>
                                <div className="text-3xl font-bold">
                                    $29<span className="text-sm font-normal">/month</span>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <ul className="space-y-2 text-sm">
                                    <li>• 100GB storage</li>
                                    <li>• 1M API calls/month</li>
                                    <li>• Priority support</li>
                                    <li>• 99.95% uptime SLA</li>
                                    <li>• Advanced analytics</li>
                                </ul>
                                <Link href="/signup">
                                    <Button className="w-full bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors">
                                        Start Pro Trial
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>

                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                            <CardHeader>
                                <CardTitle>Enterprise</CardTitle>
                                <CardDescription>For large-scale applications</CardDescription>
                                <div className="text-3xl font-bold">Custom</div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <ul className="space-y-2 text-sm">
                                    <li>• Unlimited storage</li>
                                    <li>• Unlimited API calls</li>
                                    <li>• 24/7 dedicated support</li>
                                    <li>• 99.99% uptime SLA</li>
                                    <li>• Custom integrations</li>
                                    <li>• On-premise options</li>
                                </ul>
                                <Button className="w-full bg-transparent" variant="outline">
                                    Contact Sales
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </section> */}

            {/* Footer */}
            <footer className="border-t border-white/20 py-12 px-4">
                <div className="max-w-7xl mx-auto text-center">
                    <div className="flex items-center justify-center space-x-3 mb-4">
                        <div className="p-2 bg-indigo-600 dark:bg-indigo-500 rounded-lg">
                            <Database className="h-6 w-6 text-white" />
                        </div>
                        <span className="text-2xl font-extrabold tracking-tight">
                            <span className="text-slate-900 dark:text-white">Cloud</span>
                            <span className="text-indigo-600 dark:text-indigo-400">Vault</span>
                        </span>
                    </div>
                    <p className="text-muted-foreground">
                        © 2025 CloudVault. All rights reserved. Built for developers, by developers.
                    </p>
                </div>
            </footer>
        </div>
    )
}
