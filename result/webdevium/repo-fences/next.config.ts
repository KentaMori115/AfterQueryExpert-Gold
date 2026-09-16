import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* Performance optimizations */
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  // Optimize production builds
  swcMinify: true,
  // Compress responses
  compress: true,
  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  // Reduce bundle size
  productionBrowserSourceMaps: false,
}

export default nextConfig
