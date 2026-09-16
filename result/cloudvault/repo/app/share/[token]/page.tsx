import { validateShareToken } from "@/lib/share-manager"
import { ShareAccessClient } from "./share-access-client"
import { notFound } from "next/navigation"

export default async function PublicSharePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const result = await validateShareToken(token)

    if (!result.share && result.reason === "Share link not found") {
        notFound()
    }

    const requiresPassword = Boolean(result.share?.passwordHash)

    return <ShareAccessClient token={token} requiresPassword={requiresPassword} />
}
