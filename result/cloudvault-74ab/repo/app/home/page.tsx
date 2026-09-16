import type { Metadata } from "next"
import HomeClient from "./home-client"

export const metadata: Metadata = {
    title: "Secure Cloud Storage for Developers | CloudVault",
    description: "CloudVault is a secure, fast, and simple cloud storage API. Get your API keys to upload and retrieve files with sub-100ms response times.",
    alternates: {
        canonical: "/home",
    },
}

export default function HomePage() {
    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "CloudVault",
        "operatingSystem": "All",
        "applicationCategory": "DeveloperApplication",
        "description": "Secure, fast, and developer-friendly cloud storage API. Store and retrieve files programmatically with custom API keys.",
        "offers": {
            "@type": "Offer",
            "price": "0.00",
            "priceCurrency": "USD"
        }
    }

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
            <HomeClient />
        </>
    )
}
