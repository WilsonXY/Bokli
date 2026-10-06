import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    server: {
      deps: {
        inline: ["next-auth"],
      },
    },
    // `npm run test:unit` / `npm run test:deploy` pick one; `npm test` runs both.
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"] } },
      {
        extends: true,
        test: { name: "deploy", include: ["scripts/__tests__/**/*.{spec,test}.{ts,js,mjs}"] },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "next/server": path.resolve(__dirname, "./node_modules/next/server.js"),
    },
  },
});
