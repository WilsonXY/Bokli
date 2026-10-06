import type { NextConfig } from "next";

export function resolveDistDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  if (env.BOKLI_BUILD_DIR) {
    return env.BOKLI_BUILD_DIR;
  }
  return env.NODE_ENV === "production" ? ".next-prod" : ".next";
}

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: resolveDistDir(),
  // Lint runs once in CI (`npm run lint`); linting again inside `next build`
  // would only slow builds, including the production deploy build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
