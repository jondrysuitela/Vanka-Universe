import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Static contract checks for the private-archive gallery draft migration
 * (Tahap 4G.39). Parses the SQL as TEXT only. It does NOT connect to a database,
 * does NOT execute SQL, and does NOT prove the SQL is valid on PostgreSQL.
 */

const DB_DIR = fileURLToPath(new URL("../../../../db/", import.meta.url));
const MIGRATION = "draft_migration_4g39_archive_gallery.sql";

const draft = readFileSync(path.join(DB_DIR, MIGRATION), "utf8");

describe("archive gallery draft migration — draft markers & structure", () => {
  it("is clearly marked DRAFT / not executed", () => {
    expect(draft).toContain("DRAFT");
    expect(draft).toContain("BELUM DIJALANKAN");
  });

  it("is a single transaction (exactly one BEGIN and one COMMIT)", () => {
    expect(draft.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(draft.match(/^COMMIT;/gm)).toHaveLength(1);
  });

  it("never widens media / never touches the media CHECK (audio deferred since 4G.37B)", () => {
    expect(draft).not.toContain("ALTER TABLE");
    expect(draft).not.toContain("DROP CONSTRAINT");
    expect(draft).not.toContain("chk_media_type");
  });

  it("carries a preflight block requiring private_archives", () => {
    expect(draft).toContain("DO $preflight$");
    expect(draft).toContain("private_archives belum ada");
  });
});

describe("archive gallery draft migration — table contract", () => {
  it("creates private_archive_media with the expected columns", () => {
    expect(draft).toContain("CREATE TABLE IF NOT EXISTS private_archive_media");
    for (const column of [
      "id",
      "archive_id",
      "media_id",
      "role",
      "title",
      "description",
      "memory_date",
      "position",
      "created_at",
      "updated_at",
    ]) {
      expect(draft, column).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("cascades from private_archives and does NOT FK to media", () => {
    expect(draft).toContain("REFERENCES private_archives(id) ON DELETE CASCADE");
    // media table is unused by runtime, so no FK to it (documented decision).
    expect(draft).not.toContain("REFERENCES media(id)");
  });

  it("constrains role to intro|photo and enforces one intro per archive", () => {
    expect(draft).toContain("CHECK (role IN ('intro','photo'))");
    expect(draft).toContain("uq_private_archive_media_intro");
    expect(draft).toContain("WHERE role = 'intro'");
  });

  it("enforces non-negative position and one media per archive", () => {
    expect(draft).toContain("CHECK (position >= 0)");
    expect(draft).toContain("UNIQUE (archive_id, media_id)");
  });

  it("maintains updated_at via the shared trigger function", () => {
    expect(draft).toContain("trg_private_archive_media_updated_at");
    expect(draft).toContain("EXECUTE FUNCTION update_updated_at_column()");
  });

  it("does not seed rows and declares media_id as a raw UUID (no URL/path)", () => {
    expect(draft).not.toMatch(/\bINSERT\s+INTO\s+private_archive_media\b/i);
    expect(draft).toContain("media_id     UUID NOT NULL");
  });
});
