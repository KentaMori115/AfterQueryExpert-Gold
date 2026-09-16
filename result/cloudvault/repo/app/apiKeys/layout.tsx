import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "API Keys | CloudVault",
    description: "Manage your CloudVault developer API keys.",
    robots: {
        index: false,
        follow: false,
    },
};

export default function ApiKeysLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <section>
            {children}
        </section>
    );
}
