// middleware.ts - Root level middleware for Firebase Auth
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
    // Only apply middleware to API routes that need authentication
    if (request.nextUrl.pathname.startsWith("/api/")) {
        // Skip auth for public endpoints
        const publicEndpoints = ["/api/generateapikey"]

        if (publicEndpoints.some((endpoint) => request.nextUrl.pathname.startsWith(endpoint))) {
            return NextResponse.next()
        }

        // For other API routes, they will handle their own auth via withFirebaseAuth
        return NextResponse.next()
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        "/((?!_next/static|_next/image|favicon.ico).*)",
    ],
}
