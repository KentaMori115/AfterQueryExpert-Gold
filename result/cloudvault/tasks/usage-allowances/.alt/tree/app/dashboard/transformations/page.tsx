"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Image as ImageIcon } from "lucide-react"

export default function TransformationsPage() {
    return (
        <div className="p-6 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <ImageIcon className="h-5 w-5 text-indigo-500" />
                        Dynamic Image Processing Engine
                    </CardTitle>
                    <CardDescription>
                        CloudVault includes real-time image optimization, resizing, formatting, and filtering API endpoints powered by Sharp.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs font-mono">
                    <div className="p-3 bg-muted rounded border space-y-1">
                        <p className="text-slate-500 font-sans font-semibold">Example Endpoint Usage:</p>
                        <p className="text-indigo-600">GET /api/image/:fileId?w=500&h=300&fmt=webp&q=85&grayscale=1</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
