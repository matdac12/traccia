import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Trace files from the monorepo root so standalone output includes workspace deps.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // packages/shared ships TypeScript source.
  transpilePackages: ["@traccia/shared"],
  poweredByHeader: false,
  agentRules: false,
  // proxy.ts runs on every request and Next buffers (and truncates) request bodies it sees at 10 MB,
  // which would turn an oversized upload into a "malformed multipart" error instead of the API's
  // clear "too large". Raise it well above the API's MAX_ATTACHMENT_BYTES so the API enforces the cap.
  experimental: { proxyClientMaxBodySize: "64mb" },
  // packages/shared is TypeScript source that imports siblings as "./x.js" (NodeNext style).
  // Webpack needs the alias to find the .ts files; Turbopack does not support it yet.
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
