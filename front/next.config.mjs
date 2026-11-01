/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/rnaget-beacon',
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
