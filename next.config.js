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
      allowedOrigins: ['localhost:3000']
    }
  }
}

module.exports = nextConfig
