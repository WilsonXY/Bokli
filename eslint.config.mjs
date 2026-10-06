import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  {
    ignores: ["node_modules/**", ".next/**", ".next-prod/**", "next-env.d.ts", "drizzle/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Tests stub modules and build loose fixtures; `any` there is test plumbing.
    files: ["**/*.test.ts", "scripts/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react/no-children-prop": "off",
    },
  },
  {
    // Node scripts, not React: a helper named use*() is not a hook.
    files: ["scripts/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];

export default eslintConfig;
