import type React from "react"
import type { Metadata } from "next"
import { Space_Grotesk } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@components/theme-provider"

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: {
    default: "CloudVault - Secure Cloud Storage for Developers",
    template: "%s | CloudVault"
  },
  description: "A secure, fast, and developer-friendly cloud storage API. Store and retrieve your files programmatically with custom API keys.",
  keywords: ["cloud storage", "developer api", "file upload api", "secure storage", "developer tool", "file hosting", "api storage"],
  authors: [{ name: "CloudVault Team" }],
  openGraph: {
    title: "CloudVault - Secure Cloud Storage for Developers",
    description: "A secure, fast, and developer-friendly cloud storage API.",
    url: "https://cloudvault.dev",
    siteName: "CloudVault",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CloudVault - Secure Cloud Storage for Developers",
    description: "A secure, fast, and developer-friendly cloud storage API.",
  },
  icons: {
    icon: "/facvicon.png",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={spaceGrotesk.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
