import type { NextConfig } from "next";

export function resolveDistDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  if (env.BOKLI_BUILD_DIR) {
    return env.BOKLI_BUILD_DIR;
  }
  return env.NODE_ENV === "production" ? ".next-prod" : ".next";
}

// BOKLI_TARGET=cloud builds static pages into out/ for the Worker in workers/.
// Only *.cloud.tsx files count as pages there, so the API routes, the login
// page and the middleware (all next-auth and SQLite) stay out of that build.
const cloud = process.env.BOKLI_TARGET === "cloud";

const nextConfig: NextConfig = cloud ? {
  output: "export",
  // A custom distDir is the export folder (workers/wrangler.json serves ../out);
  // Next still uses .next as scratch space for a static export.
  distDir: "out",
  // Two entries on purpose: Next 15 mangles a one-entry list into "pagecloud.tsx".
  pageExtensions: ["cloud.tsx", "cloud.ts"],
  env: { BOKLI_TARGET: "cloud" },
  eslint: { ignoreDuringBuilds: true },
} : {
  output: "standalone",
  distDir: resolveDistDir(),
  // Lint runs once in CI (`npm run lint`); linting again inside `next build`
  // would only slow builds, including the production deploy build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
