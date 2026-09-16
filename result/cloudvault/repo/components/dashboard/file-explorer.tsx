"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
    Search,
    FileText,
    Image as ImageIcon,
    Music,
    Video,
    Archive,
    File,
    Download,
    Copy,
    Trash2,
    Check,
    ChevronLeft,
    ChevronRight,
    RefreshCw,
    ExternalLink,
    Info,
    Share2,
} from "lucide-react"

export interface StoredFile {
    fileId: string
    filePath: string
    originalFilename: string
    extension: string
    size: number
    createdAt: string | Date
    apiKeyId?: string
}

interface FileExplorerProps {
    user: any
    onFileDeleted?: () => void
}

export function FileExplorer({ user, onFileDeleted }: FileExplorerProps) {
    const [files, setFiles] = useState<StoredFile[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState("")
    const [selectedCategory, setSelectedCategory] = useState("all")
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [totalFiles, setTotalFiles] = useState(0)
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [selectedFile, setSelectedFile] = useState<StoredFile | null>(null)
    const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
    const [sharingFile, setSharingFile] = useState<StoredFile | null>(null)
    const [shareTtl, setShareTtl] = useState(3600)
    const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null)
    const [isGeneratingShare, setIsGeneratingShare] = useState(false)
    const [shareError, setShareError] = useState<string | null>(null)
    const [showQr, setShowQr] = useState(false)


    const handleGenerateShare = async () => {
        if (!user || !sharingFile) return
        setIsGeneratingShare(true)
        setShareError(null)
        setGeneratedShareUrl(null)

        try {
            const idToken = await user.getIdToken()
            const res = await fetch(`/api/file/${sharingFile.fileId}/share`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ ttl: shareTtl }),
            })

            const data = await res.json()
            if (res.ok && data.success) {
                setGeneratedShareUrl(data.shareUrl)
            } else {
                throw new Error(data.message || "Failed to generate share link")
            }
        } catch (err: any) {
            console.error("Generate share error:", err)
            setShareError(err.message || "Something went wrong")
        } finally {
            setIsGeneratingShare(false)
        }
    }



    const fetchFiles = useCallback(async () => {
        if (!user) return
        setIsLoading(true)
        setError(null)
        try {
            const idToken = await user.getIdToken()
            const params = new URLSearchParams({
                page: page.toString(),
                limit: "8",
                type: selectedCategory,
            })
            if (search.trim()) {
                params.append("search", search.trim())
            }

            const res = await fetch(`/api/dashboard/files?${params.toString()}`, {
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            })

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                throw new Error(errData.message || errData.error || "Failed to load files list")
            }

            const data = await res.json()
            if (data.success) {
                setFiles(data.data || [])
                setTotalPages(data.pagination?.totalPages || 1)
                setTotalFiles(data.pagination?.total || 0)
            }
        } catch (err: any) {
            console.error("Error fetching dashboard files:", err)
            setError(err.message || "Could not retrieve files")
        } finally {
            setIsLoading(false)
        }
    }, [user, page, selectedCategory, search])

    useEffect(() => {
        fetchFiles()
    }, [fetchFiles])

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    const handleDelete = async (fileId: string) => {
        if (!user) return
        setDeletingFileId(fileId)
        try {
            const idToken = await user.getIdToken()
            const res = await fetch(`/api/delete/${fileId}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            })

            if (!res.ok) {
                const errData = await res.json()
                throw new Error(errData.message || "Failed to delete file")
            }

            // Close modal if open
            if (selectedFile?.fileId === fileId) {
                setSelectedFile(null)
            }

            await fetchFiles()
            if (onFileDeleted) onFileDeleted()
        } catch (err: any) {
            console.error("Delete file error:", err)
            alert(err.message || "Failed to delete file")
        } finally {
            setDeletingFileId(null)
        }
    }

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return "0 B"
        const k = 1024
        const sizes = ["B", "KB", "MB", "GB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i]
    }

    const getFileIcon = (ext: string) => {
        const lower = ext.toLowerCase()
        if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(lower)) {
            return <ImageIcon className="h-5 w-5 text-blue-500" />
        }
        if (["pdf", "doc", "docx", "txt", "md"].includes(lower)) {
            return <FileText className="h-5 w-5 text-emerald-500" />
        }
        if (["mp3", "wav", "ogg", "flac"].includes(lower)) {
            return <Music className="h-5 w-5 text-purple-500" />
        }
        if (["mp4", "mkv", "avi", "mov", "webm"].includes(lower)) {
            return <Video className="h-5 w-5 text-rose-500" />
        }
        if (["zip", "rar", "tar", "gz", "7z"].includes(lower)) {
            return <Archive className="h-5 w-5 text-amber-500" />
        }
        return <File className="h-5 w-5 text-slate-500" />
    }

    const categories = [
        { id: "all", label: "All Files" },
        { id: "image", label: "Images" },
        { id: "document", label: "Documents" },
        { id: "video", label: "Video" },
        { id: "audio", label: "Audio" },
        { id: "archive", label: "Archives" },
    ]

    return (
        <Card className="backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-white/20 shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                    <CardTitle className="text-xl font-bold">File Explorer</CardTitle>
                    <CardDescription>
                        Browse and manage files hosted on your connected Telegram storage ({totalFiles} items)
                    </CardDescription>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchFiles()}
                    disabled={isLoading}
                    className="h-8 border-slate-300"
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                    Refresh
                </Button>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Search & Filter Bar */}
                <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by filename or ID..."
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value)
                                setPage(1)
                            }}
                            className="pl-9 bg-white/50 dark:bg-slate-800/50"
                        />
                    </div>

                    {/* Category Filter Badges */}
                    <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
                        {categories.map((cat) => (
                            <Button
                                key={cat.id}
                                variant={selectedCategory === cat.id ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setSelectedCategory(cat.id)
                                    setPage(1)
                                }}
                                className="h-7 text-xs px-2.5 rounded-full"
                            >
                                {cat.label}
                            </Button>
                        ))}
                    </div>
                </div>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {/* File List Table */}
                {isLoading ? (
                    <div className="py-12 text-center text-muted-foreground">
                        <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-600" />
                        <p>Loading files from storage...</p>
                    </div>
                ) : files.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg border-slate-200 dark:border-slate-800">
                        <File className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        <p className="font-medium text-slate-700 dark:text-slate-300">No files found</p>
                        <p className="text-xs">Upload your first file using the uploader or API endpoints</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-100/80 dark:bg-slate-800/80 text-xs uppercase font-medium text-slate-600 dark:text-slate-400">
                                <tr>
                                    <th className="py-3 px-4">File</th>
                                    <th className="py-3 px-4">Size</th>
                                    <th className="py-3 px-4">File ID</th>
                                    <th className="py-3 px-4">Date</th>
                                    <th className="py-3 px-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                {files.map((file) => {
                                    const proxyUrl = typeof window !== "undefined"
                                        ? `${window.location.origin}/api/file/${file.fileId}?download=1`
                                        : `/api/file/${file.fileId}?download=1`

                                    return (
                                        <tr
                                            key={file.fileId}
                                            className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors"
                                        >
                                            <td className="py-3 px-4">
                                                <div className="flex items-center space-x-3">
                                                    <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg shrink-0">
                                                        {getFileIcon(file.extension)}
                                                    </div>
                                                    <div className="min-w-0 max-w-[200px] sm:max-w-[280px]">
                                                        <p className="font-medium truncate text-slate-900 dark:text-slate-100">
                                                            {file.originalFilename}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground uppercase flex items-center gap-1.5">
                                                            {file.extension || "unknown"}
                                                            {(file as any).chunks && (
                                                                <span className="bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-[9px] px-1 py-0.5 rounded-sm font-sans font-bold tracking-wider">
                                                                    Chunked
                                                                </span>
                                                            )}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                                {formatBytes(file.size)}
                                            </td>
                                            <td className="py-3 px-4 font-mono text-xs text-muted-foreground">
                                                <span className="truncate max-w-[120px] block" title={file.fileId}>
                                                    {file.fileId}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                                                {new Date(file.createdAt).toLocaleDateString(undefined, {
                                                    month: "short",
                                                    day: "numeric",
                                                    year: "numeric",
                                                })}
                                            </td>
                                            <td className="py-3 px-4 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end space-x-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => setSelectedFile(file)}
                                                        title="File Details"
                                                    >
                                                        <Info className="h-4 w-4 text-blue-500" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => setSharingFile(file)}
                                                        title="Generate Share Link"
                                                    >
                                                        <Share2 className="h-4 w-4 text-indigo-500" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => handleCopy(proxyUrl, `copy_${file.fileId}`)}
                                                        title="Copy Download URL"
                                                    >
                                                        {copiedId === `copy_${file.fileId}` ? (
                                                            <Check className="h-4 w-4 text-emerald-500" />
                                                        ) : (
                                                            <Copy className="h-4 w-4 text-slate-500" />
                                                        )}
                                                    </Button>
                                                    <a
                                                        href={proxyUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        download
                                                    >
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            title="Download File"
                                                        >
                                                            <Download className="h-4 w-4 text-slate-500" />
                                                        </Button>
                                                    </a>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                                        onClick={() => handleDelete(file.fileId)}
                                                        disabled={deletingFileId === file.fileId}
                                                        title="Delete File"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                        <p>
                            Page {page} of {totalPages}
                        </p>
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="h-8 w-8 p-0"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="h-8 w-8 p-0"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>

            {/* Details Modal overlay */}
            {selectedFile && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <Card className="w-full max-w-lg bg-white dark:bg-slate-900 border-white/20 shadow-2xl">
                        <CardHeader>
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                                        {getFileIcon(selectedFile.extension)}
                                        {selectedFile.originalFilename}
                                    </CardTitle>
                                    <CardDescription>File Metadata & Direct Links</CardDescription>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedFile(null)}
                                    className="h-8 w-8 p-0"
                                >
                                    ✕
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                            <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg text-xs font-mono">
                                <div>
                                    <span className="text-muted-foreground block font-sans">File ID</span>
                                    <span className="truncate block" title={selectedFile.fileId}>
                                        {selectedFile.fileId}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block font-sans">Size</span>
                                    <span>{formatBytes(selectedFile.size)}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block font-sans">Telegram Path</span>
                                    <span className="truncate block" title={selectedFile.filePath}>
                                        {selectedFile.filePath || "N/A"}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block font-sans">Created At</span>
                                    <span>{new Date(selectedFile.createdAt).toLocaleString()}</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">Proxy Download API Endpoint</label>
                                <div className="flex gap-2">
                                    <Input
                                        readOnly
                                        value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/file/${selectedFile.fileId}?download=1`}
                                        className="text-xs font-mono bg-slate-100 dark:bg-slate-800"
                                    />
                                    <Button
                                        size="sm"
                                        onClick={() =>
                                            handleCopy(
                                                `${window.location.origin}/api/file/${selectedFile.fileId}?download=1`,
                                                "modal_proxy"
                                            )
                                        }
                                    >
                                        {copiedId === "modal_proxy" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <a
                                    href={`/api/file/${selectedFile.fileId}?download=1`}
                                    target="_blank"
                                    rel="noreferrer"
                                    download
                                >
                                    <Button variant="default">
                                        <Download className="h-4 w-4 mr-2" /> Download
                                    </Button>
                                </a>
                                <Button
                                    variant="outline"
                                    onClick={() => setSelectedFile(null)}
                                >
                                    Close
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Share Link Modal overlay */}
            {sharingFile && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <Card className="w-full max-w-md bg-white dark:bg-slate-900 border-white/20 shadow-2xl">
                        <CardHeader>
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                                        <Share2 className="h-5 w-5 text-indigo-600 animate-pulse" />
                                        Share &quot;{sharingFile.originalFilename}&quot;
                                    </CardTitle>
                                    <CardDescription>Generate a secure link with custom expiration time</CardDescription>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setSharingFile(null)
                                        setGeneratedShareUrl(null)
                                        setShareError(null)
                                    }}
                                    className="h-8 w-8 p-0"
                                >
                                    ✕
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {!generatedShareUrl ? (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block">Link Expiration (TTL)</label>
                                        <select
                                            value={shareTtl}
                                            onChange={(e) => setShareTtl(parseInt(e.target.value, 10))}
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md p-2 text-sm"
                                        >
                                            <option value={3600}>1 Hour</option>
                                            <option value={43200}>12 Hours</option>
                                            <option value={86400}>24 Hours</option>
                                            <option value={604800}>7 Days</option>
                                        </select>
                                    </div>

                                    {shareError && (
                                        <Alert variant="destructive">
                                            <AlertDescription>{shareError}</AlertDescription>
                                        </Alert>
                                    )}

                                    <Button
                                        onClick={handleGenerateShare}
                                        disabled={isGeneratingShare}
                                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md active:scale-[0.98] transition-transform select-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                                    >
                                        {isGeneratingShare ? (
                                            <>
                                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                                Generating Link...
                                            </>
                                        ) : (
                                            "Generate Public Link"
                                        )}
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <Alert className="bg-indigo-50/50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900">
                                        <AlertDescription className="text-xs text-indigo-700 dark:text-indigo-400">
                                            Anyone with this link can download the file. It will expire in{" "}
                                            <strong>
                                                {shareTtl === 3600 && "1 hour"}
                                                {shareTtl === 43200 && "12 hours"}
                                                {shareTtl === 86400 && "24 hours"}
                                                {shareTtl === 604800 && "7 days"}
                                            </strong>.
                                        </AlertDescription>
                                    </Alert>

                                    <div className="flex gap-2">
                                        <Input
                                            readOnly
                                            value={generatedShareUrl}
                                            className="text-xs font-mono bg-slate-50 dark:bg-slate-800"
                                        />
                                        <Button
                                            size="sm"
                                            onClick={() => handleCopy(generatedShareUrl, "share_modal_link")}
                                            className="bg-indigo-600 text-white"
                                        >
                                            {copiedId === "share_modal_link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                        </Button>
                                    </div>

                                    {/* QR Code toggle action */}
                                    <div className="pt-2 text-center">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setShowQr(!showQr)}
                                            className="text-xs text-indigo-600 hover:text-indigo-700"
                                        >
                                            {showQr ? "Hide QR Code" : "Show QR Code (Experimental)"}
                                        </Button>

                                        {showQr && (
                                            <div className="mt-3 flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-800/80 rounded-lg border border-slate-200 dark:border-slate-800 animate-fadeIn">
                                                {/* Mock SVG QR Code */}
                                                <svg width="120" height="120" viewBox="0 0 29 29" className="text-slate-800 dark:text-slate-200 fill-current">
                                                    <path d="M0,0 h7 v7 h-7 z M2,2 v3 h3 v-3 z M3,3 h1 v1 h-1 z" />
                                                    <path d="M22,0 h7 v7 h-7 z M24,2 v3 h3 v-3 z M25,3 h1 v1 h-1 z" />
                                                    <path d="M0,22 h7 v7 h-7 z M2,24 v3 h3 v-3 z M25,25 h1 v1 h-1 z" />
                                                    <path d="M9,1 h1 v1 h-1 z M11,2 h2 v1 h-2 z M15,1 h3 v1 h-3 z" />
                                                    <path d="M9,9 h2 v2 h-2 z M14,9 h1 v3 h-1 z M18,8 h2 v2 h-2 z" />
                                                    <path d="M1,9 h2 v3 h-2 z M4,10 h2 v2 h-2 z M22,10 h3 v1 h-3 z" />
                                                    <path d="M10,22 h3 v2 h-3 z M16,23 h2 v1 h-2 z M20,20 h2 v3 h-2 z" />
                                                    <path d="M9,15 h3 v3 h-3 z M14,14 h2 v2 h-2 z M18,17 h2 v2 h-2 z" />
                                                </svg>
                                                <span className="text-[10px] text-muted-foreground mt-2">Scan to access the public download</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setSharingFile(null)
                                        setGeneratedShareUrl(null)
                                        setShareError(null)
                                    }}
                                >
                                    Close
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </Card>
    )
}
