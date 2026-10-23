import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Stale Cloudflare Workers / OpenNext build output left in the working
    // tree after the move to Vercel. It is gitignored, so CI never sees it, but
    // a local `npm run lint` would otherwise report ~2000 errors from bundled
    // third-party files that nobody edits.
    ".open-next/**",
    ".wrangler/**",
  ]),
]);

export default eslintConfig;
