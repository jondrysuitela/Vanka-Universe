import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Static contract checks for the birthday-letters draft migration (Tahap 4G.26).
 *
 * Parses the SQL as TEXT only. Does NOT connect to a database, does NOT execute
 * SQL, and does NOT prove the SQL is valid on PostgreSQL.
 */

const DB_DIR = fileURLToPath(new URL("../../../../db/", import.meta.url));
const MIGRATION = "draft_migration_4g26_birthday_letters.sql";

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

const block = tableBlock(draft, "birthday_letters");

describe("birthday_letters draft migration — lifecycle markers", () => {
  it("is clearly marked DRAFT / not executed and carries a preflight block", () => {
    expect(draft).toContain("DRAFT");
    expect(draft).toContain("BELUM DIJALANKAN");
    expect(draft).toContain("PREFLIGHT");
    expect(draft).toContain("DO $preflight$");
  });

  it("wraps all DDL in a single transaction", () => {
    expect(draft).toContain("\nBEGIN;");
    expect(draft.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("never seeds content or admins (no executable INSERT)", () => {
    expect(draft).not.toMatch(/^\s*INSERT\s/m);
    expect(draft).not.toMatch(/INSERT\s+INTO\s+admins/i);
  });

  it("does not touch auth-migration objects or secrets", () => {
    expect(draft).not.toContain("password_hash");
    expect(draft).not.toContain("CREATE TABLE IF NOT EXISTS sessions");
    expect(draft).not.toContain("login_attempts");
  });
});

describe("birthday_letters draft migration — table contract", () => {
  it("defines exactly the intended columns (no slug duplication)", () => {
    expect(columnNames(block).sort()).toEqual(
      [
        "id",
        "edition_id",
        "title",
        "display_date",
        "full_text",
        "sections",
        "thumbnail",
        "status",
        "scheduled_at",
        "published_at",
        "created_by",
        "created_at",
        "updated_at",
      ].sort(),
    );
    expect(columnNames(block)).not.toContain("slug");
  });

  it("enforces one letter per edition with UNIQUE + RESTRICT FK", () => {
    expect(block).toContain(
      "edition_id UUID NOT NULL UNIQUE REFERENCES birthday_editions(id) ON DELETE RESTRICT",
    );
  });

  it("stores full_text as canonical NOT NULL text", () => {
    expect(block).toMatch(/full_text TEXT NOT NULL DEFAULT ''/);
  });

  it("stores display_date as VARCHAR, never as DATE", () => {
    expect(block).toMatch(/display_date VARCHAR\(255\) NOT NULL DEFAULT ''/);
    expect(block).not.toMatch(/display_date\s+DATE/);
  });

  it("stores sections as a JSONB array with a type CHECK", () => {
    expect(block).toMatch(/sections JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    expect(draft).toContain("chk_birthday_letter_sections CHECK (jsonb_typeof(sections) = 'array')");
  });

  it("stores thumbnail as nullable JSONB object with a type CHECK", () => {
    expect(block).toMatch(/thumbnail JSONB,/);
    expect(draft).toContain(
      "chk_birthday_letter_thumbnail CHECK (thumbnail IS NULL OR jsonb_typeof(thumbnail) = 'object')",
    );
  });

  it("defaults status to draft and mirrors the content status domain", () => {
    expect(block).toContain("status VARCHAR(50) NOT NULL DEFAULT 'draft'");
    expect(draft).toContain(
      "chk_birthday_letter_status CHECK (status IN ('draft','review','scheduled','published','archived'))",
    );
  });

  it("never stores private-media references (no musicSrc)", () => {
    expect(block.toLowerCase()).not.toContain("music");
  });

  it("adds only status/created_at indexes (no duplicate edition_id index)", () => {
    expect(draft).toContain("CREATE INDEX IF NOT EXISTS idx_birthday_letters_status");
    expect(draft).toContain("CREATE INDEX IF NOT EXISTS idx_birthday_letters_created_at");
    expect(draft).not.toContain("idx_birthday_letters_edition");
  });

  it("reuses the shared updated_at trigger function from init.sql", () => {
    expect(draft).toContain("CREATE TRIGGER trg_birthday_letters_updated_at");
    expect(draft).toContain("EXECUTE FUNCTION update_updated_at_column()");
  });
});

describe("birthday_letters draft migration — preflight coverage", () => {
  it("checks prerequisites and the key drift conditions", () => {
    expect(draft).toContain("uuid-ossp");
    expect(draft).toContain("tabel admins belum ada");
    expect(draft).toContain("tabel birthday_editions belum ada");
    expect(draft).toContain("update_updated_at_column belum ada");
    expect(draft).toContain("birthday_letters.edition_id tidak UNIQUE");
    expect(draft).toContain("tidak punya FK ke birthday_editions");
    expect(draft).toContain("birthday_letters.status default bukan draft");
  });

  it("documents non-destructive idempotent import in comments", () => {
    expect(draft).toContain("ON CONFLICT (year) DO NOTHING");
    expect(draft).toContain("ON CONFLICT (edition_id) DO NOTHING");
  });
});
