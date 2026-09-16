import type React from "react"
import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "Dashboard | CloudVault",
    description: "Manage your secure cloud storage files and API keys.",
    robots: {
        index: false,
        follow: false,
    },
}

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return <>{children}</>
}
