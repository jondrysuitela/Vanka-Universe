import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Static schema-contract checks (Tahap 4G.24) — NO database required.
 *
 * These guard against drift between the documented/drafted schema, the base
 * schema, and the SQL actually issued by the application. They parse the SQL
 * files as text; they do NOT validate the SQL against PostgreSQL.
 */

const DB_DIR = fileURLToPath(new URL("../../../../db/", import.meta.url));

function readSql(file: string): string {
  return readFileSync(path.join(DB_DIR, file), "utf8");
}

/** Extract a `CREATE TABLE [IF NOT EXISTS] <table> ( ... );` block. */
function tableBlock(sql: string, table: string): string {
  const marker = sql.includes(`CREATE TABLE IF NOT EXISTS ${table} (`)
    ? `CREATE TABLE IF NOT EXISTS ${table} (`
    : `CREATE TABLE ${table} (`;
  const start = sql.indexOf(marker);
  expect(start, `CREATE TABLE ${table} tidak ditemukan`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("\n);", start);
  expect(end, `akhir CREATE TABLE ${table} tidak ditemukan`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** Column identifiers of a table block (skips constraints/keys). */
function columnNames(block: string): string[] {
  return block
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /^[a-z_][a-z0-9_]*\s/.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

describe("base schema contract (db/schema.sql)", () => {
  const schema = readSql("schema.sql");

  it("defines every base table", () => {
    for (const table of [
      "admins",
      "memories",
      "media",
      "birthday_editions",
      "content",
      "audit_logs",
    ]) {
      expect(schema, table).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
  });

  it("admins has the columns the login route / owner script query", () => {
    const cols = columnNames(tableBlock(schema, "admins"));
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "email",
        "name",
        "role",
        "is_active",
        "last_login_at",
        "created_at",
        "updated_at",
      ]),
    );
    // password_hash MUST come from the draft migration, never the base schema.
    expect(cols).not.toContain("password_hash");
  });

  it("admins role CHECK matches SessionAdmin roles", () => {
    expect(schema).toContain("CONSTRAINT chk_admins_role CHECK (role IN ('admin','owner','editor'))");
  });

  it("media defines the exact named chk_media_type constraint the archive draft widens", () => {
    // The 4g27 archive draft locates this constraint BY NAME via pg_constraint
    // and widens it to add 'audio'. If schema.sql ever renames or reshapes the
    // constraint, that preflight would fail at runtime — so pin the real
    // definition here, not merely the constraint name string anywhere in a draft.
    const block = tableBlock(schema, "media");
    expect(block).toContain("CONSTRAINT chk_media_type CHECK (media_type IN ('photo','video'))");
    expect(block).toContain("media_type VARCHAR(50) NOT NULL");
  });

  it("memories has the columns used by src/lib/memories/repository.ts", () => {
    const cols = columnNames(tableBlock(schema, "memories"));
    expect(cols).toEqual(
      expect.arrayContaining([
        "title",
        "description",
        "memory_date",
        "category",
        "privacy",
        "owner_id",
        "created_by",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("audit_logs has the columns written by src/lib/memories/audit.ts", () => {
    const cols = columnNames(tableBlock(schema, "audit_logs"));
    expect(cols).toEqual(
      expect.arrayContaining([
        "actor_id",
        "actor_email",
        "actor_label",
        "action",
        "entity_type",
        "entity_id",
        "ip_address",
        "user_agent",
        "diff_json",
        "created_at",
      ]),
    );
  });

  it("audit_logs entity CHECK still excludes admin/session actions", () => {
    expect(schema).toContain(
      "CONSTRAINT chk_audit_entity CHECK (entity_type IN ('memory','media','birthday_edition','content'))",
    );
  });

  it("audit_logs action CHECK still excludes security actions (login/logout/revoke)", () => {
    // Documented as an OPEN decision in db/SCHEMA.md §4c — not broadened here.
    expect(schema).toContain(
      "CONSTRAINT chk_audit_action CHECK (action IN ('create','read','update','delete','publish','unpublish'))",
    );
  });
});

describe("init.sql contract", () => {
  const init = readSql("init.sql");

  it("keeps the append-only audit guards and the updated_at helper", () => {
    expect(init).toContain("CREATE OR REPLACE FUNCTION update_updated_at_column()");
    expect(init).toContain("CREATE OR REPLACE FUNCTION audit_logs_no_mod()");
    expect(init).toContain("CREATE TRIGGER trg_audit_logs_no_update");
    expect(init).toContain("CREATE TRIGGER trg_audit_logs_no_delete");
  });
});

describe("draft auth migration contract (db/draft_migration_4c2a_auth_foundation.sql)", () => {
  const draft = readSql("draft_migration_4c2a_auth_foundation.sql");

  it("is clearly marked as a non-executed draft and carries a preflight block", () => {
    expect(draft).toContain("DRAFT");
    expect(draft).toContain("BELUM DIJALANKAN");
    expect(draft).toContain("PREFLIGHT");
    expect(draft).toContain("DO $preflight$");
  });

  it("adds admins.password_hash as TEXT, nullable, from the draft only", () => {
    expect(draft).toMatch(/ADD COLUMN IF NOT EXISTS password_hash TEXT/);
  });

  it("sessions has exactly the columns session.ts queries", () => {
    expect(columnNames(tableBlock(draft, "sessions")).sort()).toEqual(
      [
        "admin_id",
        "created_at",
        "expires_at",
        "id",
        "ip_address",
        "revoked_at",
        "token_hash",
        "user_agent",
      ].sort(),
    );
  });

  it("sessions enforces token_hash UNIQUE and FK ON DELETE CASCADE", () => {
    const block = tableBlock(draft, "sessions");
    expect(block).toContain("token_hash  VARCHAR(64) NOT NULL UNIQUE");
    expect(block).toContain("REFERENCES admins(id) ON DELETE CASCADE");
  });

  it("login_attempts has exactly the columns rate-limit.ts queries", () => {
    expect(columnNames(tableBlock(draft, "login_attempts")).sort()).toEqual(
      ["attempted_at", "email", "id", "ip_address", "success"].sort(),
    );
  });

  it("login_attempts.ip_address is NULLABLE so an untrusted client IP can be recorded", () => {
    // The identity-only rate-limit bucket stores `ip_address IS NULL`. With a
    // NOT NULL column the INSERT would fail for every login from a client whose
    // IP cannot be trusted, and the attempt would never be counted.
    const block = tableBlock(draft, "login_attempts");
    expect(block).toMatch(/ip_address\s+VARCHAR\(100\)\s*,/);
    expect(block).not.toMatch(/ip_address\s+VARCHAR\(100\)\s+NOT\s+NULL/);
  });

  it("login_attempts indexes the identity-only bucket", () => {
    expect(draft).toContain("idx_login_attempts_email_null_ip_time");
    expect(draft).toContain("WHERE ip_address IS NULL");
  });

  it("wraps DDL in a single transaction", () => {
    expect(draft.trimStart().startsWith("--")).toBe(true);
    expect(draft).toContain("\nBEGIN;");
    expect(draft.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("never seeds an admin account", () => {
    expect(draft).not.toMatch(/INSERT\s+INTO\s+admins/i);
  });
});
