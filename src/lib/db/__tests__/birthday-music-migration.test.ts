import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DB_DIR = fileURLToPath(new URL("../../../../db/", import.meta.url));
const migration = readFileSync(
  path.join(DB_DIR, "draft_migration_4g46_birthday_music.sql"),
  "utf8",
);

describe("birthday_music draft migration", () => {
  it("keeps media ids provider-neutral", () => {
    expect(migration).toMatch(/media_id\s+UUID,/i);
    expect(migration).not.toMatch(/media_id\s+UUID\s+REFERENCES\s+media_objects/i);
    expect(migration).toContain("filesystem, legacy R2, and db-r2");
    expect(migration).not.toContain("Prasyarat gagal: tabel media_objects belum ada.");
  });
});
