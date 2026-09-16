"use client"

import { useState, useEffect } from "react"
import { getAuthInstance } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Database,
    Key,
    Upload,
    Download,
    Trash2,
    Code,
    BookOpen,
    Copy,
    Check,
    ArrowRight,
    Shield,
    Zap,
    Globe,
} from "lucide-react"
import Link from "next/link"

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"

export default function DocsClient() {
    const [copied, setCopied] = useState<string | null>(null)
    const [user, setUser] = useState<any>(null)

    useEffect(() => {
        const auth = getAuthInstance()
        const unsubscribe = auth.onAuthStateChanged((u) => {
            setUser(u)
        })
        return () => unsubscribe()
    }, [])

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text)
        setCopied(id)
        setTimeout(() => setCopied(null), 2000)
    }

    const sidebarItems = [
        { id: "getting-started", label: "Getting Started", icon: BookOpen },
        { id: "authentication", label: "Authentication", icon: Key },
        { id: "upload", label: "Upload Files", icon: Upload },
        { id: "download", label: "Download Files", icon: Download },
        { id: "delete", label: "Delete Files", icon: Trash2 },
        { id: "examples", label: "Code Examples", icon: Code },
    ]

    const [activeSection, setActiveSection] = useState("getting-started")

    const codeExamples = {
        python: {
            upload: `import requests

# Upload a file
with open('document.pdf', 'rb') as file:
    response = requests.post(
        '${BASE_URL}/api/upload',
        headers={'Authorization': 'Bearer YOUR_API_KEY'},
        files={'file': file}
    )
    
result = response.json()
if result['success']:
    print(f"File uploaded successfully!")
    print(f"File ID: {result['data']['fileId']}")
    print(f"Size: {result['data']['sizeFormatted']}")
else:
    print(f"Upload failed: {result['message']}")`,

            download: `import requests

# Download a file
file_id = "YOUR_FILE_ID"
response = requests.get(
    f'${BASE_URL}/api/file/{file_id}',
    headers={'Authorization': 'Bearer YOUR_API_KEY'}
)

result = response.json()
if result['success']:
    print(f"Download URL: {result['data']['fileLink']}")
    print(f"File size: {result['data']['fileSizeFormatted']}")
else:
    print(f"Download failed: {result['message']}")`,
        },

        nodejs: {
            upload: `const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');

const uploadFile = async () => {
    const form = new FormData();
    form.append('file', fs.createReadStream('document.pdf'));
    
    try {
        const response = await fetch('${BASE_URL}/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer YOUR_API_KEY'
            },
            body: form
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('File uploaded successfully!');
            console.log('File ID:', result.data.fileId);
            console.log('Size:', result.data.sizeFormatted);
        } else {
            console.log('Upload failed:', result.message);
        }
    } catch (error) {
        console.error('Error:', error);
    }
};

uploadFile();`,

            download: `const fetch = require('node-fetch');

const downloadFile = async (fileId) => {
    try {
        const response = await fetch(\`${BASE_URL}/api/file/\${fileId}\`, {
            headers: {
                'Authorization': 'Bearer YOUR_API_KEY'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('Download URL:', result.data.fileLink);
            console.log('File size:', result.data.fileSizeFormatted);
        } else {
            console.log('Download failed:', result.message);
        }
    } catch (error) {
        console.error('Error:', error);
    }
};

downloadFile('YOUR_FILE_ID');`,
        },

        curl: {
            upload: `# Upload a file
curl -X POST "${BASE_URL}/api/upload" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "file=@document.pdf"

# Response:
{
  "success": true,
  "message": "File uploaded successfully!",
  "data": {
    "filename": "document.pdf",
    "fileId": "BAADBAADrwADBREAAWdIAAE...",
    "fileUrl": "https://api.telegram.org/file/bot.../document.pdf",
    "size": 1048576,
    "sizeFormatted": "1.00 MB",
    "telegramMessageId": 123,
    "uploadedAt": "2024-01-01T12:00:00.000Z",
    "apiKeyUsed": "My API Key"
  }
}`,

            download: `# Download a file
curl -X GET "${BASE_URL}/api/file/FILE_ID" \\
  -H "Authorization: Bearer YOUR_API_KEY"

# Response:
{
  "success": true,
  "data": {
    "fileId": "BAADBAADrwADBREAAWdIAAE...",
    "fileLink": "https://api.telegram.org/file/bot.../document.pdf",
    "fileSize": 1048576,
    "fileSizeFormatted": "1.00 MB",
    "accessedAt": "2024-01-01T12:00:00.000Z",
    "apiKeyUsed": "My API Key"
  }
}`,
        },
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <ThemeToggle />

            {/* Navigation */}
            <nav className="border-b border-white/20 backdrop-blur-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <Link href={user ? "/dashboard" : "/"} className="flex items-center space-x-3">
                            <div className="p-1 bg-white/10 dark:bg-slate-900/10 rounded-lg">
                                <img src="/facvicon.png" alt="CloudVault Logo" className="h-8 w-8 object-contain" />
                            </div>
                            <span className="text-2xl font-extrabold tracking-tight">
                                <span className="text-slate-900 dark:text-white">Cloud</span>
                                <span className="text-indigo-600 dark:text-indigo-400">Vault</span>
                            </span>
                        </Link>
                        <div className="flex items-center space-x-4">
                            <Link href="/home">
                                <Button variant="outline">Home</Button>
                            </Link>
                            <Link href="/dashboard">
                                <Button className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors">
                                    Dashboard
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="grid lg:grid-cols-4 gap-8">
                    {/* Sidebar */}
                    <div className="lg:col-span-1">
                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20 sticky top-8">
                            <CardHeader>
                                <CardTitle className="text-lg">Documentation</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {sidebarItems.map((item) => (
                                    <Button
                                        key={item.id}
                                        variant={activeSection === item.id ? "default" : "ghost"}
                                        className="w-full justify-start"
                                        onClick={() => setActiveSection(item.id)}
                                    >
                                        <item.icon className="h-4 w-4 mr-2" />
                                        {item.label}
                                    </Button>
                                ))}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Main Content */}
                    <div className="lg:col-span-3 space-y-8">
                        {/* Getting Started */}
                        {activeSection === "getting-started" && (
                            <div className="space-y-6">
                                <div>
                                    <h1 className="text-4xl font-bold mb-4">CloudVault API Documentation</h1>
                                    <p className="text-xl text-muted-foreground">
                                        Simple, secure, and fast file storage API powered by Telegram
                                    </p>
                                </div>

                                <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                    <CardHeader>
                                        <CardTitle>Quick Start</CardTitle>
                                        <CardDescription>Get up and running in 5 minutes</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="grid md:grid-cols-3 gap-4">
                                            <div className="text-center p-4 border rounded-lg">
                                                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-2">
                                                    <span className="text-blue-600 font-bold">1</span>
                                                </div>
                                                <h3 className="font-semibold mb-1">Setup Telegram Bot</h3>
                                                <p className="text-sm text-muted-foreground">Create a bot via @BotFather</p>
                                            </div>
                                            <div className="text-center p-4 border rounded-lg">
                                                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-2">
                                                    <span className="text-blue-600 font-bold">2</span>
                                                </div>
                                                <h3 className="font-semibold mb-1">Get API Key</h3>
                                                <p className="text-sm text-muted-foreground">Generate your API key in dashboard</p>
                                            </div>
                                            <div className="text-center p-4 border rounded-lg">
                                                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-2">
                                                    <span className="text-blue-600 font-bold">3</span>
                                                </div>
                                                <h3 className="font-semibold mb-1">Start Building</h3>
                                                <p className="text-sm text-muted-foreground">Use our API to store files</p>
                                            </div>
                                        </div>

                                        <div className="flex space-x-4">
                                            <Link href="/signup">
                                                <Button className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors">
                                                    Get Started <ArrowRight className="ml-2 h-4 w-4" />
                                                </Button>
                                            </Link>
                                            <Button variant="outline" onClick={() => setActiveSection("examples")}>
                                                View Examples
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>

                                <div className="grid md:grid-cols-3 gap-6">
                                    <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                        <CardHeader>
                                            <Shield className="h-8 w-8 text-blue-600 mb-2" />
                                            <CardTitle className="text-lg">Secure</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-sm text-muted-foreground">
                                                End-to-end encryption with API key authentication and secure Telegram infrastructure
                                            </p>
                                        </CardContent>
                                    </Card>

                                    <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                        <CardHeader>
                                            <Zap className="h-8 w-8 text-green-600 mb-2" />
                                            <CardTitle className="text-lg">Fast</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-sm text-muted-foreground">
                                                Lightning-fast uploads and downloads with global Telegram CDN infrastructure
                                            </p>
                                        </CardContent>
                                    </Card>

                                    <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                        <CardHeader>
                                            <Globe className="h-8 w-8 text-purple-600 mb-2" />
                                            <CardTitle className="text-lg">Global</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-sm text-muted-foreground">
                                                Worldwide availability with automatic failover and data replication
                                            </p>
                                        </CardContent>
                                    </Card>
                                </div>
                            </div>
                        )}

                        {/* Authentication */}
                        {activeSection === "authentication" && (
                            <div className="space-y-6">
                                <div>
                                    <h1 className="text-3xl font-bold mb-4">Authentication</h1>
                                    <p className="text-muted-foreground">
                                        CloudVault uses API keys for authentication. Include your API key in the Authorization header.
                                    </p>
                                </div>

                                <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                    <CardHeader>
                                        <CardTitle>API Key Authentication</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div>
                                            <h4 className="font-semibold mb-2">Header Format</h4>
                                            <div className="relative">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="absolute top-2 right-2 z-10 bg-transparent"
                                                    onClick={() => copyToClipboard("Authorization: Bearer YOUR_API_KEY", "auth-header")}
                                                >
                                                    {copied === "auth-header" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                                </Button>
                                                <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm">
                                                    <code>Authorization: Bearer YOUR_API_KEY</code>
                                                </pre>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold mb-2">Example Request</h4>
                                            <div className="relative">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="absolute top-2 right-2 z-10 bg-transparent"
                                                    onClick={() =>
                                                        copyToClipboard(
                                                            `curl -X POST "${BASE_URL}/api/upload" \\
  -H "Authorization: Bearer cvk_1234567890abcdef" \\
  -F "file=@document.pdf"`,
                                                            "auth-example",
                                                        )
                                                    }
                                                >
                                                    {copied === "auth-example" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                                </Button>
                                                <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                                    <code>{`curl -X POST "${BASE_URL}/api/upload" \\
  -H "Authorization: Bearer cvk_1234567890abcdef" \\
  -F "file=@document.pdf"`}</code>
                                                </pre>
                                            </div>
                                        </div>

                                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                                            <h4 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">Security Note</h4>
                                            <p className="text-sm text-yellow-700 dark:text-yellow-300">
                                                Keep your API keys secure and never expose them in client-side code. Use environment variables
                                                or secure configuration management.
                                            </p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* Upload Files */}
                        {activeSection === "upload" && (
                            <div className="space-y-6">
                                <div>
                                    <h1 className="text-3xl font-bold mb-4">Upload Files</h1>
                                    <p className="text-muted-foreground">Upload files to your Telegram storage via the API.</p>
                                </div>

                                <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                    <CardHeader>
                                        <CardTitle>POST /api/upload</CardTitle>
                                        <CardDescription>Upload a file to your Telegram storage</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div>
                                            <h4 className="font-semibold mb-2">Request</h4>
                                            <div className="space-y-2">
                                                <p className="text-sm">
                                                    <strong>Method:</strong> POST
                                                </p>
                                                <p className="text-sm">
                                                    <strong>Content-Type:</strong> multipart/form-data
                                                </p>
                                                <p className="text-sm">
                                                    <strong>Authorization:</strong> Bearer YOUR_API_KEY
                                                </p>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold mb-2">Parameters</h4>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-sm border-collapse border border-gray-300 dark:border-gray-600">
                                                    <thead>
                                                        <tr className="bg-gray-50 dark:bg-gray-800">
                                                            <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left">
                                                                Parameter
                                                            </th>
                                                            <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left">Type</th>
                                                            <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left">
                                                                Required
                                                            </th>
                                                            <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left">
                                                                Description
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        <tr>
                                                            <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">file</td>
                                                            <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">File</td>
                                                            <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">Yes</td>
                                                            <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">
                                                                The file to upload (max 50MB)
                                                            </td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold mb-2">Response</h4>
                                            <div className="relative">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="absolute top-2 right-2 z-10 bg-transparent"
                                                    onClick={() =>
                                                        copyToClipboard(
                                                            JSON.stringify(
                                                                {
                                                                    success: true,
                                                                    message: "File uploaded successfully!",
                                                                    data: {
                                                                        filename: "document.pdf",
                                                                        fileId: "BAADBAADrwADBREAAWdIAAE...",
                                                                        size: 1048576,
                                                                        sizeFormatted: "1.00 MB",
                                                                        telegramMessageId: 123,
                                                                        uploadedAt: "2024-01-01T12:00:00.000Z",
                                                                        apiKeyUsed: "My API Key",
                                                                    },
                                                                },
                                                                null,
                                                                2,
                                                            ),
                                                            "upload-response",
                                                        )
                                                    }
                                                >
                                                    {copied === "upload-response" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                                </Button>
                                                <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                                    <code>
                                                        {JSON.stringify(
                                                            {
                                                                success: true,
                                                                message: "File uploaded successfully!",
                                                                data: {
                                                                    filename: "document.pdf",
                                                                    fileId: "BAADBAADrwADBREAAWdIAAE...",
                                                                    size: 1048576,
                                                                    sizeFormatted: "1.00 MB",
                                                                    telegramMessageId: 123,
                                                                    uploadedAt: "2024-01-01T12:00:00.000Z",
                                                                    apiKeyUsed: "My API Key",
                                                                },
                                                            },
                                                            null,
                                                            2,
                                                        )}
                                                    </code>
                                                </pre>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* Download Files */}
                        {activeSection === "download" && (
                            <div className="space-y-6">
                                <div>
                                    <h1 className="text-3xl font-bold mb-4">Download Files</h1>
                                    <p className="text-muted-foreground">Retrieve download links for your uploaded files.</p>
                                </div>

                                <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                    <CardHeader>
                                        <CardTitle>GET /api/file/:fileId</CardTitle>
                                        <CardDescription>Get a download link for a specific file</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div>
                                            <h4 className="font-semibold mb-2">Request</h4>
                                            <div className="space-y-2">
                                                <p className="text-sm">
                                                    <strong>Method:</strong> GET
                                                </p>
                                                <p className="text-sm">
                                                    <strong>Authorization:</strong> Bearer YOUR_API_KEY
                                                </p>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold mb-2">URL Parameters</h4>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-sm border-collapse border border-gray-300 dark:border-gray-600">
                                                    <thead>
                                                        <tr className="bg-gray-50 dark:bg-gray-800">
                                                            <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left">
                                                                Parameter
                                                            </th>
                                                            <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left">Type</th>
                                                            <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left">
                                                                Description
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        <tr>
                                                            <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">fileId</td>
                                                            <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">String</td>
                                                            <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">
                                                                The file ID returned from upload
                                                            </td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold mb-2">Response</h4>
                                            <div className="relative">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="absolute top-2 right-2 z-10 bg-transparent"
                                                    onClick={() =>
                                                        copyToClipboard(
                                                            JSON.stringify(
                                                                {
                                                                    success: true,
                                                                    data: {
                                                                        fileId: "BAADBAADrwADBREAAWdIAAE...",
                                                                        fileLink: "https://api.telegram.org/file/bot.../document.pdf",
                                                                        fileSize: 1048576,
                                                                        fileSizeFormatted: "1.00 MB",
                                                                        accessedAt: "2024-01-01T12:00:00.000Z",
                                                                        apiKeyUsed: "My API Key",
                                                                    },
                                                                },
                                                                null,
                                                                2,
                                                            ),
                                                            "download-response",
                                                        )
                                                    }
                                                >
                                                    {copied === "download-response" ? (
                                                        <Check className="h-4 w-4" />
                                                    ) : (
                                                        <Copy className="h-4 w-4" />
                                                    )}
                                                </Button>
                                                <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                                    <code>
                                                        {JSON.stringify(
                                                            {
                                                                success: true,
                                                                data: {
                                                                    fileId: "BAADBAADrwADBREAAWdIAAE...",
                                                                    fileLink: "https://api.telegram.org/file/bot.../document.pdf",
                                                                    fileSize: 1048576,
                                                                    fileSizeFormatted: "1.00 MB",
                                                                    accessedAt: "2024-01-01T12:00:00.000Z",
                                                                    apiKeyUsed: "My API Key",
                                                                },
                                                            },
                                                            null,
                                                            2,
                                                        )}
                                                    </code>
                                                </pre>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* Code Examples */}
                        {activeSection === "examples" && (
                            <div className="space-y-6">
                                <div>
                                    <h1 className="text-3xl font-bold mb-4">Code Examples</h1>
                                    <p className="text-muted-foreground">Ready-to-use code examples in popular programming languages.</p>
                                </div>

                                <Tabs defaultValue="python" className="w-full">
                                    <TabsList className="grid w-full grid-cols-3">
                                        <TabsTrigger value="python">Python</TabsTrigger>
                                        <TabsTrigger value="nodejs">Node.js</TabsTrigger>
                                        <TabsTrigger value="curl">cURL</TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="python" className="space-y-4">
                                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                            <CardHeader>
                                                <CardTitle>Python Examples</CardTitle>
                                                <CardDescription>Using the requests library</CardDescription>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div>
                                                    <h4 className="font-semibold mb-2">Upload File</h4>
                                                    <div className="relative">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="absolute top-2 right-2 z-10 bg-transparent"
                                                            onClick={() => copyToClipboard(codeExamples.python.upload, "python-upload")}
                                                        >
                                                            {copied === "python-upload" ? (
                                                                <Check className="h-4 w-4" />
                                                            ) : (
                                                                <Copy className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                        <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                                            <code>{codeExamples.python.upload}</code>
                                                        </pre>
                                                    </div>
                                                </div>

                                                <div>
                                                    <h4 className="font-semibold mb-2">Download File</h4>
                                                    <div className="relative">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="absolute top-2 right-2 z-10 bg-transparent"
                                                            onClick={() => copyToClipboard(codeExamples.python.download, "python-download")}
                                                        >
                                                            {copied === "python-download" ? (
                                                                <Check className="h-4 w-4" />
                                                            ) : (
                                                                <Copy className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                        <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                                            <code>{codeExamples.python.download}</code>
                                                        </pre>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </TabsContent>

                                    <TabsContent value="nodejs" className="space-y-4">
                                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                            <CardHeader>
                                                <CardTitle>Node.js Examples</CardTitle>
                                                <CardDescription>Using node-fetch and form-data</CardDescription>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div>
                                                    <h4 className="font-semibold mb-2">Upload File</h4>
                                                    <div className="relative">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="absolute top-2 right-2 z-10 bg-transparent"
                                                            onClick={() => copyToClipboard(codeExamples.nodejs.upload, "nodejs-upload")}
                                                        >
                                                            {copied === "nodejs-upload" ? (
                                                                <Check className="h-4 w-4" />
                                                            ) : (
                                                                <Copy className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                        <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                                            <code>{codeExamples.nodejs.upload}</code>
                                                        </pre>
                                                    </div>
                                                </div>

                                                <div>
                                                    <h4 className="font-semibold mb-2">Download File</h4>
                                                    <div className="relative">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="absolute top-2 right-2 z-10 bg-transparent"
                                                            onClick={() => copyToClipboard(codeExamples.nodejs.download, "nodejs-download")}
                                                        >
                                                            {copied === "nodejs-download" ? (
                                                                <Check className="h-4 w-4" />
                                                            ) : (
                                                                <Copy className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                        <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                                            <code>{codeExamples.nodejs.download}</code>
                                                        </pre>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </TabsContent>

                                    <TabsContent value="curl" className="space-y-4">
                                        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20">
                                            <CardHeader>
                                                <CardTitle>cURL Examples</CardTitle>
                                                <CardDescription>Command line examples</CardDescription>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div>
                                                    <h4 className="font-semibold mb-2">Upload File</h4>
                                                    <div className="relative">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="absolute top-2 right-2 z-10 bg-transparent"
                                                            onClick={() => copyToClipboard(codeExamples.curl.upload, "curl-upload")}
                                                        >
                                                            {copied === "curl-upload" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                                        </Button>
                                                        <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                                            <code>{codeExamples.curl.upload}</code>
                                                        </pre>
                                                    </div>
                                                </div>

                                                <div>
                                                    <h4 className="font-semibold mb-2">Download File</h4>
                                                    <div className="relative">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="absolute top-2 right-2 z-10 bg-transparent"
                                                            onClick={() => copyToClipboard(codeExamples.curl.download, "curl-download")}
                                                        >
                                                            {copied === "curl-download" ? (
                                                                <Check className="h-4 w-4" />
                                                            ) : (
                                                                <Copy className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                        <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg text-sm overflow-x-auto">
                                                            <code>{codeExamples.curl.download}</code>
                                                        </pre>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </TabsContent>
                                </Tabs>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
