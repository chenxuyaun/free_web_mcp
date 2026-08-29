/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sub-path deployment behind the yuncai.site nginx proxy (/webmcp → :3100).
  // Keep in sync with BASE_PATH in lib/paths.ts (client fetches need it).
  basePath: "/webmcp",
  transpilePackages: [],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@bnb-chain/greenfield-js-sdk", "@bnb-chain/reed-solomon"],
  },
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
