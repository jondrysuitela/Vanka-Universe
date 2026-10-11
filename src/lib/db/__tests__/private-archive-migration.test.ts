import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Static contract checks for the private-archive draft migration (Tahap 4G.27).
 *
 * Parses the SQL as TEXT only. Does NOT connect to a database, does NOT execute
 * SQL, and does NOT prove the SQL is valid on PostgreSQL.
 */

const DB_DIR = fileURLToPath(new URL("../../../../db/", import.meta.url));
const MIGRATION = "draft_migration_4g27_private_archive.sql";

const draft = readFileSync(path.join(DB_DIR, MIGRATION), "utf8");

function tableBlock(sql: string, table: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = sql.indexOf(marker);
  expect(start, `CREATE TABLE ${table} tidak ditemukan`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("\n);", start);
  expect(end, `akhir CREATE TABLE ${table} tidak ditemukan`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

function columnNames(block: string): string[] {
  return block
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /^[a-z_][a-z0-9_]*\s/.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

const block = tableBlock(draft, "private_archives");

describe("private_archives draft migration — lifecycle markers", () => {
  it("is clearly marked DRAFT / not executed and carries the preflight DO block", () => {
    expect(draft).toContain("DRAFT");
    expect(draft).toContain("BELUM DIJALANKAN");
    expect(draft).toContain("DO $preflight$");
    // Audio support was deliberately deferred (Stage 4G.37B): the media widening
    // DO block must be gone.
    expect(draft).not.toContain("$media_audio$");
  });

  it("wraps all DDL in a single transaction", () => {
    expect(draft).toContain("\nBEGIN;");
    expect(draft.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("never seeds content or admins (no executable INSERT)", () => {
    expect(draft).not.toMatch(/^\s*INSERT\s/m);
    expect(draft).not.toMatch(/INSERT\s+INTO\s+admins/i);
  });

  it("does not touch auth or birthday-letter objects / secrets", () => {
    expect(draft).not.toContain("password_hash");
    expect(draft).not.toContain("CREATE TABLE IF NOT EXISTS sessions");
    expect(draft).not.toContain("CREATE TABLE IF NOT EXISTS birthday_letters");
    expect(draft).not.toContain("CREATE TABLE IF NOT EXISTS content");
  });
});

describe("private_archives draft migration — table contract", () => {
  it("defines exactly the intended columns and no privacy column", () => {
    expect(columnNames(block).sort()).toEqual(
      [
        "id",
        "slug",
        "title",
        "narrative",
        "music_enabled",
        "music_media_id",
        "status",
        "created_by",
        "created_at",
        "updated_at",
      ].sort(),
    );
    // The archive is always private; authorization is server-side, not a flag.
    expect(block).not.toContain("privacy");
    expect(columnNames(block)).not.toContain("music_src");
  });

  it("enforces a stable unique slug identity", () => {
    expect(block).toContain("slug VARCHAR(255) NOT NULL UNIQUE");
  });

  it("references private audio by FK to media, never by URL/path", () => {
    expect(block).toContain("music_media_id UUID REFERENCES media(id) ON DELETE RESTRICT");
    expect(block).not.toContain("musicSrc");
    // No URL/path column types for audio.
    expect(draft).not.toMatch(/music[^\n]*TEXT/i);
  });

  it("defaults status to draft with a draft|archived domain", () => {
    expect(block).toContain("status VARCHAR(50) NOT NULL DEFAULT 'draft'");
    expect(draft).toContain("chk_private_archive_status CHECK (status IN ('draft','archived'))");
  });

  it("adds only status/music_media indexes (no duplicate slug index)", () => {
    expect(draft).toContain("CREATE INDEX IF NOT EXISTS idx_private_archives_status");
    expect(draft).toContain("CREATE INDEX IF NOT EXISTS idx_private_archives_music_media");
    expect(draft).not.toContain("idx_private_archives_slug");
  });

  it("reuses the shared updated_at trigger function from init.sql", () => {
    expect(draft).toContain("CREATE TRIGGER trg_private_archives_updated_at");
    expect(draft).toContain("EXECUTE FUNCTION update_updated_at_column()");
  });
});

describe("private_archives draft migration — audio support deferred (Stage 4G.37B)", () => {
  it("does not widen media.media_type and never touches the media CHECK", () => {
    expect(draft).not.toContain("'photo','video','audio'");
    expect(draft).not.toContain("ALTER TABLE media");
    expect(draft).not.toContain("DROP CONSTRAINT chk_media_type");
    // No widening DO block remains.
    expect(draft).not.toContain("$media_audio$");
  });

  it("keeps the audio reference column as a nullable FK so audio is not required", () => {
    expect(block).toContain("music_media_id UUID REFERENCES media(id) ON DELETE RESTRICT");
  });
});

describe("private_archives draft migration — preflight coverage", () => {
  it("checks prerequisites and drift conditions", () => {
    expect(draft).toContain("uuid-ossp");
    expect(draft).toContain("tabel admins belum ada");
    expect(draft).toContain("update_updated_at_column belum ada");
    expect(draft).toContain("private_archives.slug tidak UNIQUE");
    expect(draft).toContain("tidak punya FK ke media");
    expect(draft).toContain("tidak punya FK ke admins");
    expect(draft).toContain("private_archives.status default bukan draft");
  });

  it("documents non-destructive idempotent import in comments", () => {
    expect(draft).toContain("ON CONFLICT (slug) DO NOTHING");
  });
});
