/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@bnb-chain/greenfield-js-sdk", "@bnb-chain/reed-solomon"],
  },
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
