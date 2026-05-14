import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Enables React strict mode for catching potential issues early
  reactStrictMode: true,

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  // Prevent Twilio (server-only) from being bundled in client chunks
  serverExternalPackages: ['twilio'],
}

export default nextConfig
