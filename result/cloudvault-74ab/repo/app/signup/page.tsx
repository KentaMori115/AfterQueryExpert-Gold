import type { Metadata } from "next"
import SignupClient from "./signup-client"

export const metadata: Metadata = {
    title: "Create an Account | CloudVault Developer Storage",
    description: "Get started with CloudVault. Create an account to register a secure, developer-friendly cloud storage API key and start uploading files in minutes.",
    alternates: {
        canonical: "/signup",
    },
}

export default function SignupPage() {
    return <SignupClient />
}
