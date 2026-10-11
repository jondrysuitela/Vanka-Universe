import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Cross-migration static contract checks (Tahap 4G.29) — NO database required.
 *
 * Verifies the whole planned chain together: schema.sql → init.sql →
 * draft 4c2a → draft 4g26 → draft 4g27. Reads the SQL files as TEXT and
 * inspects the ACTUAL source definitions (constraints, FKs, tables, helper
 * function), not just name mentions. Does NOT execute SQL and does NOT prove
 * the SQL is valid on PostgreSQL.
 */

const DB_DIR = fileURLToPath(new URL("../../../../db/", import.meta.url));

function readDb(file: string): string {
  return readFileSync(path.join(DB_DIR, file), "utf8");
}

const AUTH = "draft_migration_4c2a_auth_foundation.sql";
const BIRTHDAY = "draft_migration_4g26_birthday_letters.sql";
const ARCHIVE = "draft_migration_4g27_private_archive.sql";

const schema = readDb("schema.sql");
const init = readDb("init.sql");
const schemaDoc = readDb("SCHEMA.md");
const checklist = readDb("MIGRATION_CHECKLIST.md");

const drafts: ReadonlyArray<{ name: string; sql: string; table?: string }> = [
  { name: AUTH, sql: readDb(AUTH) },
  { name: BIRTHDAY, sql: readDb(BIRTHDAY), table: "birthday_letters" },
  { name: ARCHIVE, sql: readDb(ARCHIVE), table: "private_archives" },
];

const BASE_TABLES = ["admins", "memories", "media", "birthday_editions", "content", "audit_logs"];
const DRAFT_ONLY_TABLES = ["sessions", "login_attempts", "birthday_letters", "private_archives"];

/** Every `REFERENCES <table>(` target in a SQL string. */
function referenceTargets(sql: string): string[] {
  return [...sql.matchAll(/REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1]);
}

describe("migration chain — lifecycle and transaction discipline", () => {
  it("marks every draft DRAFT / not executed / not tested", () => {
    for (const { name, sql } of drafts) {
      expect(sql, name).toContain("DRAFT");
      expect(sql, name).toContain("BELUM DIJALANKAN");
      expect(sql, name).toContain("BELUM DIUJI terhadap PostgreSQL");
    }
  });

  it("runs every draft in a single transaction with a preflight block", () => {
    for (const { name, sql } of drafts) {
      expect(sql, name).toContain("\nBEGIN;");
      expect(sql, name).toContain("DO $preflight$");
      expect(sql.trimEnd().endsWith("COMMIT;"), name).toBe(true);
      // Fail-closed: each preflight must be able to abort.
      expect(sql, name).toContain("RAISE EXCEPTION");
    }
  });

  it("never seeds rows (no executable INSERT in any draft)", () => {
    for (const { name, sql } of drafts) {
      expect(sql, name).not.toMatch(/^\s*INSERT\s/m);
    }
  });
});

describe("migration chain — prerequisites defined in the base schema", () => {
  it("schema.sql creates the extension, helper tables and function prerequisites", () => {
    expect(schema).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    for (const table of BASE_TABLES) {
      expect(schema, table).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
    expect(init).toContain("CREATE OR REPLACE FUNCTION update_updated_at_column()");
  });

  it("every FK target of every draft exists in the base schema (no hidden cross-draft dependency)", () => {
    for (const { name, sql } of drafts) {
      const targets = referenceTargets(sql);
      expect(targets.length, `${name} has no FK?`).toBeGreaterThan(0);
      for (const target of targets) {
        expect(BASE_TABLES, `${name} references ${target}`).toContain(target);
        expect(DRAFT_ONLY_TABLES, `${name} must not reference draft table ${target}`).not.toContain(target);
      }
    }
  });

  it("each draft defines its own table exactly once and table-owning drafts reuse the shared helper", () => {
    for (const { name, sql, table } of drafts) {
      if (table) {
        const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
        expect(sql.split(marker).length - 1, name).toBe(1);
        // The helper is defined once (init.sql) and reused, never redefined.
        expect(sql, name).toContain("EXECUTE FUNCTION update_updated_at_column()");
      }
      // No draft may redefine the shared helper function.
      expect(sql, name).not.toContain("CREATE OR REPLACE FUNCTION update_updated_at_column");
      expect(sql, name).not.toContain("CREATE FUNCTION update_updated_at_column");
    }
  });
});

describe("migration chain — documented execution order", () => {
  it("SCHEMA.md lists the files in the runtime-valid order", () => {
    const order = [
      "db/schema.sql",
      "db/init.sql",
      `db/${AUTH}`,
      `db/${BIRTHDAY}`,
      `db/${ARCHIVE}`,
    ];
    const positions = order.map((f) => schemaDoc.indexOf(f));
    for (let i = 0; i < positions.length; i += 1) {
      expect(positions[i], order[i]).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(positions[i], `${order[i]} after ${order[i - 1]}`).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("the central checklist identifies all three drafts and their verification docs", () => {
    expect(checklist).toContain(`db/${AUTH}`);
    expect(checklist).toContain(`db/${BIRTHDAY}`);
    expect(checklist).toContain(`db/${ARCHIVE}`);
    // Detailed verification for the non-auth drafts lives in their plan docs.
    expect(checklist).toContain("BIRTHDAY_PERSISTENCE_PLAN.md");
    expect(checklist).toContain("PRIVATE_ARCHIVE_SCHEMA_PLAN.md");
  });
});

describe("migration chain — audit domain stays closed (documented open decision)", () => {
  it("does not broaden the audit CHECKs in the base schema", () => {
    expect(schema).toContain(
      "CONSTRAINT chk_audit_entity CHECK (entity_type IN ('memory','media','birthday_edition','content'))",
    );
    expect(schema).toContain(
      "CONSTRAINT chk_audit_action CHECK (action IN ('create','read','update','delete','publish','unpublish'))",
    );
  });

  it("documents the proposed entities/actions as OPEN in SCHEMA.md", () => {
    expect(schemaDoc).toContain("Keputusan terbuka");
    expect(schemaDoc).toContain("birthday_letter");
    expect(schemaDoc).toContain("private_archive");
    expect(schemaDoc).toContain("revoke");
  });
});
