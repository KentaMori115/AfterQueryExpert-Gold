import type { Metadata } from "next"
import LoginClient from "./login-client"

export const metadata: Metadata = {
    title: "Sign In | CloudVault Developer Storage",
    description: "Sign in to your CloudVault developer account to manage your secure cloud storage API keys, configure storage settings, and view usage statistics.",
    alternates: {
        canonical: "/",
    },
}

export default function LoginPage() {
    return <LoginClient />
}
