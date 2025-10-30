/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/**'
      }
    ]
  },
  experimental: {
    serverActions: {
  allowedOrigins: ['localhost:3303']
    }
  }
}

module.exports = nextConfig
