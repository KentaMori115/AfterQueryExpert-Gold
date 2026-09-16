"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { UploadCloud, File, CheckCircle2, AlertCircle, Copy, Check, ArrowRight } from "lucide-react"
import type { ApiKeyData } from "@/lib/firestore"

interface DragDropUploaderProps {
    apiKeys: ApiKeyData[]
    onUploadSuccess?: () => void
}

export function DragDropUploader({ apiKeys, onUploadSuccess }: DragDropUploaderProps) {
    const [isDragging, setIsDragging] = useState(false)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [selectedApiKey, setSelectedApiKey] = useState<string>(apiKeys[0]?.apiKey || "")
    const [isUploading, setIsUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [uploadResult, setUploadResult] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const MAX_SIZE = 250 * 1024 * 1024 // 250 MB

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0]
            validateAndSetFile(file)
        }
    }

    const validateAndSetFile = (file: File) => {
        setError(null)
        setUploadResult(null)
        if (file.size > MAX_SIZE) {
            setError(`File "${file.name}" exceeds the 250MB maximum limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).`)
            return
        }
        setSelectedFile(file)
    }

    const handleUpload = async () => {
        if (!selectedFile) return
        const keyToUse = selectedApiKey || apiKeys[0]?.apiKey
        if (!keyToUse) {
            setError("No active API Key available. Please create an API key first.")
            return
        }

        setIsUploading(true)
        setError(null)
        setUploadProgress(20)

        try {
            const formData = new FormData()
            formData.append("file", selectedFile)

            setUploadProgress(50)

            const res = await fetch("/api/upload", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${keyToUse}`,
                },
                body: formData,
            })

            setUploadProgress(85)
            const data = await res.json()

            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to upload file")
            }

            setUploadProgress(100)
            setUploadResult(data.data)
            setSelectedFile(null)

            if (onUploadSuccess) {
                onUploadSuccess()
            }
        } catch (err: any) {
            console.error("Upload error:", err)
            setError(err.message || "An unexpected error occurred during upload")
        } finally {
            setIsUploading(false)
        }
    }

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20 shadow-lg">
            <CardHeader>
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                    <UploadCloud className="h-5 w-5 text-blue-600" /> Web Drag & Drop Uploader
                </CardTitle>
                <CardDescription>
                    Upload files up to 250MB directly to Telegram cloud storage via API proxy
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Dropzone area */}
                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${
                        isDragging
                            ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 scale-[1.01]"
                            : "border-slate-300 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 bg-slate-50/50 dark:bg-slate-950/50"
                    }`}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                                validateAndSetFile(e.target.files[0])
                            }
                        }}
                    />

                    <div className="flex flex-col items-center justify-center space-y-2">
                        <div className="p-3 bg-blue-100 dark:bg-blue-900/40 rounded-full text-blue-600 dark:text-blue-400">
                            <UploadCloud className="h-8 w-8 animate-bounce" />
                        </div>
                        <div>
                            <p className="font-semibold text-sm">
                                {isDragging ? "Drop file here to stage upload" : "Drag and drop your file here, or click to browse"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">Supports any format up to 250 MB</p>
                        </div>
                    </div>
                </div>

                {/* API Key selector if user has multiple keys */}
                {apiKeys.length > 1 && (
                    <div className="flex items-center space-x-2 text-xs">
                        <span className="text-muted-foreground whitespace-nowrap">API Key:</span>
                        <select
                            value={selectedApiKey}
                            onChange={(e) => setSelectedApiKey(e.target.value)}
                            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs w-full"
                        >
                            {apiKeys.map((key) => (
                                <option key={key.id} value={key.apiKey}>
                                    {key.name} ({key.apiKey.substring(0, 10)}...)
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Staged File Info */}
                {selectedFile && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg flex items-center justify-between">
                        <div className="flex items-center space-x-3 truncate">
                            <File className="h-5 w-5 text-blue-600 shrink-0" />
                            <div className="truncate text-xs">
                                <p className="font-medium truncate">{selectedFile.name}</p>
                                <p className="text-muted-foreground">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                            </div>
                        </div>
                        <Button
                            onClick={handleUpload}
                            disabled={isUploading}
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 ml-2"
                        >
                            {isUploading ? "Uploading..." : "Start Upload"}
                        </Button>
                    </div>
                )}

                {/* Progress Bar */}
                {isUploading && (
                    <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Uploading to Telegram...</span>
                            <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div
                                className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                                style={{ width: `${uploadProgress}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Error Banner */}
                {error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {/* Upload Result Success Banner */}
                {uploadResult && (
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-xl space-y-3">
                        <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                            <CheckCircle2 className="h-5 w-5 shrink-0" />
                            <span>File uploaded successfully!</span>
                        </div>

                        <div className="text-xs space-y-2 font-mono">
                            <div className="flex justify-between bg-white/70 dark:bg-slate-900/70 p-2 rounded border border-emerald-100 dark:border-emerald-900">
                                <span className="text-muted-foreground">File ID:</span>
                                <span className="font-bold truncate ml-2">{uploadResult.fileId}</span>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    readOnly
                                    value={uploadResult.fileUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/api/file/${uploadResult.fileId}?download=1`}
                                    className="w-full bg-white/70 dark:bg-slate-900/70 p-2 rounded border border-emerald-100 dark:border-emerald-900 text-xs truncate"
                                />
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleCopy(uploadResult.fileUrl || `${window.location.origin}/api/file/${uploadResult.fileId}?download=1`)}
                                    className="shrink-0"
                                >
                                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
