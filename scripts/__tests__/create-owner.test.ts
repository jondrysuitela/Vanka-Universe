import { describe, expect, it } from "vitest";

// Mengimpor skrip CLI SUNGGUHAN. Aman karena create-owner.mjs hanya
// mengeksekusi main() saat dijalankan langsung (guard isDirectRun); impor ini
// tidak membuka koneksi DB dan tidak meminta password.
import {
  BCRYPT_COST,
  EMAIL_SCHEMA,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  NAME_SCHEMA,
  SafeCliError,
  describeError,
  parseArgs,
} from "../create-owner.mjs";

describe("create-owner.mjs — konstanta", () => {
  it("memakai bcrypt cost 12 (sama dengan default password.ts)", () => {
    expect(BCRYPT_COST).toBe(12);
  });

  it("selaras dengan lebar kolom database", () => {
    expect(MAX_EMAIL_LENGTH).toBe(255); // admins.email VARCHAR(255)
    expect(MAX_NAME_LENGTH).toBe(255); // admins.name VARCHAR(255)
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});

describe("create-owner.mjs — validasi email", () => {
  it("menolak email dengan spasi di ujung (zod memvalidasi sebelum trim)", () => {
    // ZOD v4: z.email() memvalidasi string apa adanya; .trim() berjalan setelahnya.
    // Karena itu parseArgs() men-trim argumen lebih dulu sebelum skema ini.
    expect(EMAIL_SCHEMA.safeParse("  Owner@Example.COM  ").success).toBe(false);
    expect(EMAIL_SCHEMA.safeParse("Owner@Example.COM").success).toBe(true);
  });

  it("menolak format tidak valid", () => {
    for (const bad of ["not-an-email", "@example.com", "user@", "a b@example.com"]) {
      expect(EMAIL_SCHEMA.safeParse(bad).success).toBe(false);
    }
  });

  it("menolak email melebihi 255 karakter", () => {
    const tooLong = "a".repeat(MAX_EMAIL_LENGTH) + "@example.com";
    expect(tooLong.length).toBeGreaterThan(MAX_EMAIL_LENGTH);
    expect(EMAIL_SCHEMA.safeParse(tooLong).success).toBe(false);
  });
});

describe("create-owner.mjs — validasi nama", () => {
  it("menerima nama valid dan men-trim", () => {
    const result = NAME_SCHEMA.safeParse("  Ayah Vanka  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("Ayah Vanka");
  });

  it("menolak nama kosong setelah trim", () => {
    expect(NAME_SCHEMA.safeParse("").success).toBe(false);
    expect(NAME_SCHEMA.safeParse("   ").success).toBe(false);
  });

  it("menolak nama melebihi 255 karakter", () => {
    expect(NAME_SCHEMA.safeParse("A".repeat(MAX_NAME_LENGTH + 1)).success).toBe(false);
  });

  it("menerima nama tepat 255 karakter", () => {
    expect(NAME_SCHEMA.safeParse("A".repeat(MAX_NAME_LENGTH)).success).toBe(true);
  });
});

describe("create-owner.mjs — parseArgs (argv)", () => {
  /** Replikasi kecil dari pengambilan argv asli agar parseArgs bisa diuji. */
  function withArgv(argv, fn) {
    const original = process.argv;
    process.argv = ["node", "scripts/create-owner.mjs", ...argv];
    try {
      return fn();
    } finally {
      process.argv = original;
    }
  }

  it("mengembalikan email ternormalisasi dan nama ter-trim", () => {
    const result = withArgv(["  OWNER@Example.com ", "  Ayah  "], () => parseArgs());
    expect(result).toEqual({ email: "owner@example.com", name: "Ayah" });
  });

  it("menolak tanpa argumen", () => {
    expect(() => withArgv([], () => parseArgs())).toThrow(/pemakaian/);
  });

  it("menolak argumen kurang (nama hilang)", () => {
    expect(() => withArgv(["owner@example.com"], () => parseArgs())).toThrow(/pemakaian/);
  });

  it("menolak argumen berlebih (password tidak boleh lewat argv)", () => {
    expect(() => withArgv(["owner@example.com", "Ayah", "rahasia"], () => parseArgs())).toThrow(
      /pemakaian/,
    );
  });

  it("menolak email tidak valid", () => {
    expect(() => withArgv(["not-email", "Ayah"], () => parseArgs())).toThrow(/email tidak valid/);
  });

  it("menolak nama kosong", () => {
    expect(() => withArgv(["owner@example.com", "   "], () => parseArgs())).toThrow(/name wajib/);
  });
});

describe("create-owner.mjs — describeError tidak membocorkan rahasia", () => {
  it("memetakan errno koneksi ke pesan generik (tanpa detail)", () => {
    const message = describeError(Object.assign(new Error("boom"), { code: "ECONNREFUSED" }));
    expect(message).toMatch(/tidak dapat terhubung ke PostgreSQL/);
    expect(message).not.toMatch(/boom/);
  });

  it("menyertakan SQLSTATE aman untuk galat skema", () => {
    const err = Object.assign(new Error("relation \"admins\" does not exist"), { code: "42P01" });
    const message = describeError(err);
    expect(message).toMatch(/\[42P01\]/);
    expect(message).not.toMatch(/relation/);
  });

  it("Menyembunyikan pesan mentah driver untuk kode tak dikenal", () => {
    const err = Object.assign(new Error("password authentication failed for user \"vanka\""), {
      code: "XX000",
    });
    const message = describeError(err);
    expect(message).not.toMatch(/password authentication/);
    expect(message).not.toMatch(/vanka/);
    expect(message).toMatch(/tidak ditampilkan/);
  });

  it("meneruskan pesan SafeCliError (pesan internal yang sudah aman)", () => {
    expect(describeError(new SafeCliError("ditolak: contoh."))).toBe("ditolak: contoh.");
  });
});
