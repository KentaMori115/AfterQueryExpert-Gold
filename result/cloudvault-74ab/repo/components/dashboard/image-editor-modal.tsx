"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Image as ImageIcon, Copy, Check } from "lucide-react"

interface ImageEditorModalProps {
    fileId: string | null
    isOpen: boolean
    onClose: () => void
}

export function ImageEditorModal({ fileId, isOpen, onClose }: ImageEditorModalProps) {
    const [width, setWidth] = useState("400")
    const [height, setHeight] = useState("")
    const [format, setFormat] = useState("webp")
    const [quality, setQuality] = useState("80")
    const [grayscale, setGrayscale] = useState(false)
    const [copied, setCopied] = useState(false)

    if (!fileId) return null

    const previewUrl = `/api/image/${fileId}?w=${width}&h=${height}&fmt=${format}&q=${quality}${
        grayscale ? "&grayscale=1" : ""
    }`

    const copyUrl = () => {
        const full = `${window.location.origin}${previewUrl}`
        navigator.clipboard.writeText(full)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ImageIcon className="h-5 w-5 text-indigo-500" />
                        Dynamic Image Transformation Generator
                    </DialogTitle>
                    <DialogDescription>
                        Generate real-time optimized CDN image URLs for <code className="bg-secondary px-1 rounded">{fileId}</code>.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
                    <div className="space-y-3 text-xs">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <Label>Width (px)</Label>
                                <Input value={width} onChange={(e) => setWidth(e.target.value)} placeholder="400" />
                            </div>
                            <div>
                                <Label>Height (px)</Label>
                                <Input value={height} onChange={(e) => setHeight(e.target.value)} placeholder="Auto" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <Label>Format</Label>
                                <select
                                    value={format}
                                    onChange={(e) => setFormat(e.target.value)}
                                    className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
                                >
                                    <option value="webp">WebP</option>
                                    <option value="avif">AVIF</option>
                                    <option value="png">PNG</option>
                                    <option value="jpeg">JPEG</option>
                                </select>
                            </div>
                            <div>
                                <Label>Quality (%)</Label>
                                <Input value={quality} onChange={(e) => setQuality(e.target.value)} placeholder="80" />
                            </div>
                        </div>

                        <label className="flex items-center gap-2 pt-1 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={grayscale}
                                onChange={(e) => setGrayscale(e.target.checked)}
                                className="rounded"
                            />
                            <span>Apply Grayscale Filter</span>
                        </label>
                    </div>

                    <div className="flex flex-col items-center justify-center p-3 border rounded-lg bg-muted/40 min-h-[160px]">
                        <img
                            src={previewUrl}
                            alt="Transformation Preview"
                            className="max-h-36 max-w-full object-contain rounded shadow-sm"
                        />
                        <span className="text-[11px] text-slate-400 mt-2">Live Processed Stream Preview</span>
                    </div>
                </div>

                <div className="space-y-1.5 pt-2">
                    <Label className="text-xs font-semibold">Generated Transformation API URL</Label>
                    <div className="flex gap-2">
                        <Input value={previewUrl} readOnly className="font-mono text-xs" />
                        <Button onClick={copyUrl} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                    </div>
                </div>

                <DialogFooter className="pt-2">
                    <Button onClick={onClose}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
