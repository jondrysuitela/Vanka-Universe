import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Cache Components and `partialPrefetching` are DISABLED on purpose.
  //
  // Cache Components pages render as a sequence of event loop tasks and Next.js
  // detects stage boundaries with `process.nextTick`. workerd implements
  // `process.nextTick` as a microtask (cloudflare/workerd#7687), so the staged
  // render never completes and every page request is cancelled with
  // "your Worker's code had hung" (HTTP 500). Upstream fix PR #1318 is not
  // released yet, so this workaround is required to run on Cloudflare Workers.
  // See the temporary copy experiment in Phase 2D/2E for the evidence.
  //
  // To re-enable: restore `cacheComponents: true` and `partialPrefetching: true`
  // here and restore `export const instant = false;` in
  // src/app/admin/(protected)/layout.tsx — only once an adapter release
  // containing PR #1318 is in use.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // `pg-cloudflare` (an optional dependency of `pg`) publishes runtime-conditional
  // exports: `workerd` -> `./dist/index.js`, `default` -> `./dist/empty.js`.
  // Next's file tracing resolves the `default` condition and copies only
  // `dist/empty.js`, while the Cloudflare adapter's esbuild step resolves the
  // `workerd` condition and needs `dist/index.js`. Trace the whole package so
  // both agree.
  outputFileTracingIncludes: {
    "/**/*": ["node_modules/pg-cloudflare/**/*"],
  },
};

export default nextConfig;
