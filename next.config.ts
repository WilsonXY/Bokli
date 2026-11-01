import type { NextConfig } from "next";

// Static pages in out/, served by the Worker in workers/ (workers/wrangler.json
// serves ../out). Next still uses .next as scratch space for a static export.
const nextConfig: NextConfig = {
  output: "export",
  distDir: "out",
  // Lint runs once in CI (`npm run lint`).
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
