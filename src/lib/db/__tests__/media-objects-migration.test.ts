import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Static contract checks for the media_objects draft migration (Tahap 4G.40D-3B).
 * Parses the SQL as TEXT only: no database is contacted and no SQL is executed.
 */

const DB_DIR = fileURLToPath(new URL("../../../../db/", import.meta.url));
const MIGRATION = "draft_migration_4g40d3b_media_objects.sql";
const draft = readFileSync(path.join(DB_DIR, MIGRATION), "utf8");

describe("media_objects draft migration — markers & structure", () => {
  it("is clearly marked DRAFT / not executed", () => {
    expect(draft).toContain("DRAFT");
    expect(draft).toContain("BELUM DIJALANKAN");
  });

  it("is a single transaction (exactly one BEGIN and one COMMIT)", () => {
    expect(draft.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(draft.match(/^COMMIT;/gm)).toHaveLength(1);
  });

  it("never alters the legacy media table", () => {
    expect(draft).not.toMatch(/ALTER TABLE\s+media\b/i);
    expect(draft).not.toMatch(/DROP TABLE/i);
    expect(draft).not.toMatch(/\bREFERENCES\s+media\b/i);
  });

  it("carries a foundation preflight block", () => {
    expect(draft).toContain("DO $foundation$");
  });

  it("does NOT require uuid-ossp (no server-side UUID default is used)", () => {
    // Mentioned only in a comment; there is no extension CHECK and no uuid call.
    expect(draft).not.toMatch(/extname\s*=\s*'uuid-ossp'/);
    expect(draft).not.toMatch(/DEFAULT\s+uuid_generate/i);
    expect(draft).not.toMatch(/PRIMARY KEY\s+DEFAULT/i);
  });

  it("verifies an existing table's shape and aborts on mismatch", () => {
    expect(draft).toContain("DO $structure$");
    expect(draft).toContain("information_schema.columns");
    expect(draft).toContain("pg_constraint");
    expect(draft).toContain("pg_trigger");
    expect(draft).toContain("RAISE EXCEPTION");
    // The check must cover the FK to admins and the updated_at trigger.
    expect(draft).toContain("confrelid = 'public.admins'::regclass");
    expect(draft).toContain("trg_media_objects_updated_at");
  });
});

describe("media_objects draft migration — table contract", () => {
  it("creates media_objects with the expected columns", () => {
    expect(draft).toContain("CREATE TABLE IF NOT EXISTS media_objects");
    for (const column of [
      "id",
      "status",
      "storage_provider",
      "storage_key",
      "mime_type",
      "kind",
      "file_size",
      "display_name",
      "owner_id",
      "owner_label",
      "title",
      "description",
      "taken_at",
      "created_at",
      "updated_at",
    ]) {
      expect(draft).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("constrains status to pending|ready and kind to image|video", () => {
    expect(draft).toContain("CHECK (status IN ('pending','ready'))");
    expect(draft).toContain("CHECK (kind IN ('image','video'))");
    expect(draft).toContain("CREATE INDEX IF NOT EXISTS idx_media_objects_status");
  });

  it("defaults status to pending and uses a server-supplied UUID", () => {
    expect(draft).toMatch(/status\s+VARCHAR\(20\)\s+NOT NULL\s+DEFAULT\s+'pending'/i);
    expect(draft).toMatch(/id\s+UUID\s+PRIMARY KEY/i);
    expect(draft).not.toMatch(/id\s+UUID\s+PRIMARY KEY\s+DEFAULT/i);
  });

  it("maintains updated_at via the shared trigger function", () => {
    expect(draft).toContain("trg_media_objects_updated_at");
    expect(draft).toContain("EXECUTE FUNCTION update_updated_at_column()");
  });

  it("does not seed rows", () => {
    expect(draft).not.toMatch(/\bINSERT\s+INTO\s+media_objects\b/i);
  });
});
