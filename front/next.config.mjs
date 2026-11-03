/** @type {import('next').NextConfig} */
const apiProxyTarget =
  process.env.API_PROXY_TARGET?.replace(/\/$/, '') || 'http://127.0.0.1:5000'

const nextConfig = {
  output: 'export',
  basePath: '/rnaget-beacon',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Static export + nginx use /rnaget-beacon/api in production. In `next dev`, same
  // relative base would hit the Next server (404) unless we proxy to the API.
  async rewrites() {
    return [
      {
        source: '/rnaget-beacon/api/:path*',
        destination: `${apiProxyTarget}/:path*`,
      },
    ]
  },
}

export default nextConfig
