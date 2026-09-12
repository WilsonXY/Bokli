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
};

export default nextConfig;
