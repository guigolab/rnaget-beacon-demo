/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/rnaget-beacon',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
