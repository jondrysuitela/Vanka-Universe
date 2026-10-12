import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Minimal OpenNext Cloudflare adapter configuration.
 *
 * No cache/queue/tag-cache overrides are provided, so the adapter falls back to
 * its built-in no-op ("dummy") implementations. That means this project needs
 * no R2 bucket, D1 database, or Durable Object to build and run locally.
 *
 * Cache interception is left disabled (the default): the adapter documents that
 * it is incompatible with PPR, and this app enables `cacheComponents` /
 * `partialPrefetching` in `next.config.ts`.
 *
 * See: https://opennext.js.org/cloudflare/caching
 */
export default defineCloudflareConfig({});
