/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@asq/sdk', '@asq/auth'],
};

export default nextConfig;
