import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
// Physical location of @bnb-chain/reed-solomon (declared by packages/storage).
// Its node.adapter spawns a worker_threads Worker from a sibling file, which
// webpack bundling breaks — so greenfield.ts loads it at runtime via
// webpackIgnore from this absolute path instead.
const reedSolomonAdapter = path.join(
  appDir,
  "..",
  "..",
  "packages",
  "storage",
  "node_modules",
  "@bnb-chain",
  "reed-solomon",
  "dist",
  "node.adapter.js",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    REED_SOLOMON_ADAPTER: reedSolomonAdapter,
  },
  reactStrictMode: true,
  transpilePackages: [],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@bnb-chain/greenfield-js-sdk", "@bnb-chain/reed-solomon"],
  },
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
