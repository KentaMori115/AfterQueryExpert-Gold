import type { Metadata } from "next"
import DocsClient from "./docs-client"

export const metadata: Metadata = {
    title: "API Documentation & Developer Guide | CloudVault",
    description: "Learn how to integrate CloudVault cloud storage. Follow our API guides for uploading, retrieving, and deleting files using curl, Node.js, and Python.",
    alternates: {
        canonical: "/docs",
    },
}

export default function DocsPage() {
    return <DocsClient />
}
