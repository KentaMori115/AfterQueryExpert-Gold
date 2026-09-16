"use client"

import { Card, CardContent } from "@/components/ui/card"

interface ImagePreviewCardProps {
    fileId: string
    filename: string
    onOpenEditor: () => void
}

export function ImagePreviewCard({ fileId, filename, onOpenEditor }: ImagePreviewCardProps) {
    const thumbUrl = `/api/image/${fileId}?w=250&h=180&fmt=webp&q=75`

    return (
        <Card
            onClick={onOpenEditor}
            className="group cursor-pointer overflow-hidden border hover:border-indigo-300 transition-all shadow-sm hover:shadow-md"
        >
            <div className="h-36 bg-slate-100 dark:bg-slate-900 flex items-center justify-center overflow-hidden relative">
                <img
                    src={thumbUrl}
                    alt={filename}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
            </div>
            <CardContent className="p-3 text-xs">
                <p className="font-medium truncate text-foreground">{filename}</p>
                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5">Click to Transform API</p>
            </CardContent>
        </Card>
    )
}
