import { MetadataRoute } from "next"

// Keep crawl rules aligned with public marketing routes.
export default function robots(): MetadataRoute.Robots {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://cloudvault.dev"
    
    return {
        rules: {
            userAgent: "*",
            allow: ["/", "/home", "/signup", "/docs"],
            disallow: ["/dashboard", "/apiKeys", "/api/"],
        },
        sitemap: `${baseUrl}/sitemap.xml`,
    }
}
