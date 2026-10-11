// ============================================================================
// create-owner.mjs — Operator CLI: buat akun owner PERTAMA di PostgreSQL lokal.
//
// STATUS (Tahap 4G.15: hardening): skrip diperbarui, BELUM pernah dieksekusi di
// tahap ini (tidak ada database yang boleh diakses). Jalankan manual HANYA setelah:
//   1. db/schema.sql, db/init.sql, dan
//      db/draft_migration_4c2a_auth_foundation.sql diterapkan ke PostgreSQL
//      lokal, dan seluruh checklist verifikasi information_schema lulus;
//   2. DATABASE_URL tersedia di environment proses ini (operator mengelola
//      .env.local sendiri — skrip ini TIDAK membaca file .env mana pun).
//
// Pemakaian:  node scripts/create-owner.mjs <email> <name>
//
// Jaminan keamanan:
//   * Driver `pg` (sama dengan DB_DRIVER=pg pada src/lib/db.ts). Tidak memakai
//     driver serverless Neon; tidak ada dependency baru (pg, bcryptjs, zod
//     sudah terpasang).
//   * Password HANYA dari input tersembunyi (TTY raw mode) atau stdin non-TTY
//     (pipe/file — tidak ada terminal yang menampilkan isinya). TIDAK PERNAH
//     dari argv, environment variable, atau log.
//   * Hash bcrypt cost 12, identik dengan default src/lib/auth/password.ts.
//     Password tidak pernah dicetak dan tidak pernah disimpan selain sebagai hash.
//   * Pesan gagal selalu generik: tidak pernah mencetak password, DSN/connection
//     string, atau pesan error mentah dari driver. Hanya SQLSTATE yang aman.
//   * Pool ditutup pada SEMUA jalur keluar (try/finally), termasuk batal di
//     tengah jalan.
//   * Guard satu-owner-aktif + unik email ditegakkan; re-check dijalankan di
//     dalam transaksi dengan advisory lock agar dua proses serentak tidak sama-
//     sama membuat owner.
//   * Tidak ada baris audit: db/schema.sql `chk_audit_entity` tidak mengizinkan
//     entity_type 'admin' dan tidak diubah pada tahap ini.
//
// BATASAN JUJUR: penyamaran input memakai mode raw TTY (setRawMode — API publik,
// bukan properti internal readline) dan diverifikasi lewat `stdin.isRaw`. Bila
// verifikasi itu gagal, skrip BERHENTI dengan pesan jelas alih-alih meminta
// password tanpa penyamaran. Perilaku ini BELUM diuji secara empiris di Windows
// pada tahap ini; jalur stdin non-TTY dipakai sebagai fallback aman.
// ============================================================================

import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { hash } from "bcryptjs";
import { z } from "zod";

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME_LENGTH = 255; // admins.name VARCHAR(255)
const MAX_EMAIL_LENGTH = 255; // admins.email VARCHAR(255)
const CONNECTION_TIMEOUT_MS = 10_000;
// Kunci advisory transaksional khusus skrip ini (bigint). Hanya berlama selama
// transaksi; dipakai agar pemeriksaan owner aktif + INSERT tidak balapan.
const OWNER_ADVISORY_LOCK = 4200415;

// Skema email IDENTIK dengan LOGIN_SCHEMA pada
// src/app/api/auth/login/route.ts (z.email().trim().toLowerCase().max(255)),
// agar akun yang dibuat di sini pasti bisa dipakai untuk login. Duplikasi
// disengaja: skrip CLI berdiri sendiri (tidak mengimpor modul TypeScript yang
// butuh transpilasi runtime).
const EMAIL_SCHEMA = z.email().trim().toLowerCase().max(MAX_EMAIL_LENGTH);
const NAME_SCHEMA = z.string().trim().min(1).max(MAX_NAME_LENGTH);

/** Galat dengan pesan yang sudah dianggap aman (tidak pernah memuat rahasia). */
class SafeCliError extends Error {
  constructor(message) {
    super(message);
    this.name = "SafeCliError";
  }
}

// ----------------------------------------------------------------------------
// Argumen — divalidasi SEBELUM koneksi & SEBELUM password diminta.
// ----------------------------------------------------------------------------
function parseArgs() {
  const [emailArg, nameArg, ...rest] = process.argv.slice(2);
  if (!emailArg || !nameArg || rest.length > 0) {
    throw new SafeCliError("pemakaian: node scripts/create-owner.mjs <email> <name>");
  }
  const email = EMAIL_SCHEMA.safeParse(String(emailArg).trim());
  if (!email.success) {
    throw new SafeCliError("email tidak valid (format: nama@domain.tld).");
  }
  const name = NAME_SCHEMA.safeParse(nameArg);
  if (!name.success) {
    throw new SafeCliError(`name wajib 1-${MAX_NAME_LENGTH} karakter setelah di-trim.`);
  }
  return { email: email.data, name: name.data };
}

// ----------------------------------------------------------------------------
// Input password TANPA tampilan di layar.
// ----------------------------------------------------------------------------

/** Non-TTY (pipe/file): tidak ada terminal yang menampilkan input => tanpa echo. */
function readLineFromStdin() {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let settled = false;
    let value = "";

    const settle = (fn, v) => {
      if (settled) return;
      settled = true;
      process.stdin.removeAllListeners();
      process.stdin.pause();
      fn(v);
    };

    process.stdin.on("data", (chunk) => {
      const text = decoder.write(chunk);
      for (const char of text) {
        if (char === "\r" || char === "\n") return settle(resolve, value);
        if (char === "\u0003" || char === "\u0004") return settle(reject, new SafeCliError("dibatalkan."));
        value += char;
      }
    });
    process.stdin.on("close", () =>
      settle(reject, new SafeCliError("stdin ditutup sebelum password diterima.")),
    );
    process.stdin.on("error", (err) => settle(reject, err));
  });
}

/** TTY interaktif: baca per karakter dalam raw mode, echo hanya '*'. */
function readHiddenLineFromTty(stdin) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let value = "";
    let settled = false;

    const cleanup = () => {
      stdin.removeAllListeners();
      try {
        stdin.setRawMode(false);
      } catch {
        /* mode sudah pulih; abaikan */
      }
      stdin.pause();
    };
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      cleanup();
      process.stdout.write("\n");
      fn(arg);
    };

    function onData(chunk) {
      const text = decoder.write(chunk);
      for (const char of text) {
        if (char === "\r" || char === "\n") return settle(resolve, value);
        if (char === "\u0003" || char === "\u0004") {
          return settle(reject, new SafeCliError("dibatalkan."));
        }
        if (char === "\u007f" || char === "\u0008") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += char;
        process.stdout.write("*");
      }
    }

    stdin.on("data", onData);
    stdin.on("error", (err) => settle(reject, err));
    stdin.resume();
  });
}

/**
 * @returns {Promise<string>} password yang dimasukkan operator.
 * Bila penyamaran tidak dapat dijamin, LEMPAR SafeCliError (tidak pernah
 * meminta password begitu saja).
 */
async function readPassword() {
  const stdin = process.stdin;

  // Fallback aman: stdin bukan TTY (redirect dari file / pipe) => tidak ada
  // terminal yang menampilkan isinya.
  if (!stdin.isTTY) {
    process.stdout.write("Password: ");
    return await readLineFromStdin();
  }

  try {
    stdin.setRawMode(true);
  } catch {
    throw new SafeCliError(
      "terminal ini tidak mendukung mode raw sehingga password tidak dapat disembunyikan. " +
        "Proses dihentikan — jalankan lewat stdin non-interaktif, mis. " +
        "Get-Content -Raw file-password | node scripts/create-owner.mjs <email> <name>",
    );
  }
  if (stdin.isRaw !== true) {
    try {
      stdin.setRawMode(false);
    } catch {
      /* abaikan */
    }
    throw new SafeCliError(
      "penyamaran input password tidak dapat diverifikasi pada terminal ini; " +
        "proses dihentikan. Jalankan lewat stdin non-interaktif agar password tidak tampil.",
    );
  }

  process.stdout.write("Password: ");
  return await readHiddenLineFromTty(stdin);
}

// ----------------------------------------------------------------------------
// Pesan galat aman: tanpa password, tanpa connection string, tanpa pesan mentah.
// ----------------------------------------------------------------------------
const SAFE_DB_MESSAGES = {
  ECONNREFUSED: "tidak dapat terhubung ke PostgreSQL (koneksi ditolak).",
  ENOTFOUND: "host database tidak dapat diselesaikan.",
  ETIMEDOUT: "konektivitas ke database habis waktu.",
  EHOSTUNREACH: "host database tidak terjangkau.",
  ENETUNREACH: "jaringan menuju database tidak terjangkau.",
  ENOENT: "endpoint/berkas koneksi tidak ditemukan.",
  "28P01": "otentikasi database ditolak (periksa kredensial DATABASE_URL).",
  "28000": "akses database ditolak.",
  "3D000": "database tujuan tidak ditemukan.",
  "42P01":
    "tabel tidak ditemukan — terapkan db/schema.sql lalu db/draft_migration_4c2a_auth_foundation.sql.",
  "42703":
    "kolom tidak ditemukan — struktur skema belum lengkap; jalankan checklist verifikasi information_schema.",
  "42710": "objek duplikat — migration mungkin sudah pernah dijalankan dengan definisi berbeda.",
  "23505": "pelanggaran unique constraint (kemungkinan email sudah terdaftar).",
  "23514": "pelanggaran CHECK constraint pada admins (role harus 'admin' | 'owner' | 'editor').",
  "23503": "pelanggaran foreign key (referensi admins tidak ada).",
  "22001": "data terlalu panjang untuk kolom VARCHAR (email/name maks 255).",
  "40001": "konflik konkurensi — jalankan ulang skrip.",
  "40P01": "deadlock terdeteksi — jalankan ulang skrip.",
  "57014": "query dibatalkan oleh server.",
  "53300": "koneksi penuh; server tidak menerima koneksi baru.",
};

function describeError(error) {
  if (error instanceof SafeCliError) return error.message;
  const code = typeof error?.code === "string" ? error.code : null;
  if (code && SAFE_DB_MESSAGES[code]) {
    const safe = SAFE_DB_MESSAGES[code];
    return /^[0-9A-Z]{5}$/.test(code) ? `${safe} [${code}]` : safe;
  }
  const name = typeof error?.name === "string" ? error.name : "Error";
  return (
    "operasi gagal. Detail driver tidak ditampilkan agar password dan " +
    `connection string tidak bocor. (${name})`
  );
}

// ----------------------------------------------------------------------------
// Alur utama.
// ----------------------------------------------------------------------------
async function main() {
  const { email, name } = parseArgs();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new SafeCliError(
      "DATABASE_URL tidak diatur. Sediakan DATABASE_URL PostgreSQL lokal pada " +
        "environment proses sebelum menjalankan skrip ini.",
    );
  }

  // Driver sama dengan src/lib/db.ts (DB_DRIVER=pg). max:1 agar satu koneksi.
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });

  try {
    // Guard 1: tolak lebih awal bila sudah ada owner aktif (hemat prompt password).
    const owners = await pool.query(
      "SELECT count(*)::int AS n FROM admins WHERE role = 'owner' AND is_active = true",
    );
    const ownerCount = owners.rows[0]?.n ?? 0;
    if (ownerCount > 0) {
      throw new SafeCliError(
        `ditolak: sudah ada owner aktif (${ownerCount}). Nonaktifkan owner lama ` +
          "(set is_active = false) sebelum membuat owner baru.",
      );
    }

    // Guard 2: pesan ramah untuk duplikat email, sebelum password diminta.
    const taken = await pool.query("SELECT 1 FROM admins WHERE email = $1", [email]);
    if (taken.rows.length > 0) {
      throw new SafeCliError(`ditolak: email sudah terdaftar (${email}).`);
    }

    // Password: hanya input tersembunyi; tidak pernah argv/env.
    const password = await readPassword();
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new SafeCliError(`error: password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
    }
    const passwordHash = await hash(password, BCRYPT_COST);

    // Tulis final, di dalam transaksi + advisory lock, dengan guard diulang.
    let txOpen = false;
    try {
      await pool.query("BEGIN");
      txOpen = true;
      await pool.query("SELECT pg_advisory_xact_lock($1)", [OWNER_ADVISORY_LOCK]);

      const lockedOwners = await pool.query(
        "SELECT count(*)::int AS n FROM admins WHERE role = 'owner' AND is_active = true",
      );
      if ((lockedOwners.rows[0]?.n ?? 0) > 0) {
        throw new SafeCliError(
          "ditolak: owner aktif lain dibuat serentak dengan skrip ini. Periksa kembali.",
        );
      }

      const inserted = await pool.query(
        `INSERT INTO admins (email, name, role, is_active, password_hash)
         VALUES ($1, $2, 'owner', true, $3)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, role`,
        [email, name, passwordHash],
      );

      if (inserted.rows.length === 0) {
        // ON CONFLICT aktif: tentukan penyebabnya tanpa mengubah apa pun.
        const nowTaken = await pool.query("SELECT 1 FROM admins WHERE email = $1", [email]);
        if (nowTaken.rows.length > 0) {
          throw new SafeCliError(`ditolak: email sudah terdaftar (${email}).`);
        }
        throw new SafeCliError(
          "ditolak: gagal membuat owner tanpa penyebab yang dapat dipastikan; tidak ada data yang diubah.",
        );
      }

      await pool.query("COMMIT");
      txOpen = false;
      // Hanya identitas yang tidak sensitif.
      console.log(
        `created: ${inserted.rows[0].email} (role ${inserted.rows[0].role}, id ${inserted.rows[0].id})`,
      );
    } finally {
      if (txOpen) {
        try {
          await pool.query("ROLLBACK");
        } catch {
          /* koneksi akan ditutup di bawah */
        }
      }
    }
  } finally {
    try {
      await pool.end();
    } catch {
      /* tidak ada yang dapat dilakukan saat penutupan gagal */
    }
  }
}

// Tidak memakai process.exit() di dalam main: semua jalur keluar melewati
// finally di atas, lalu kode keluar ditetapkan di sini.
//
// Guard "dijalankan langsung": main() hanya dieksekusi bila modul dipanggil
// sebagai CLI (node scripts/create-owner.mjs ...). Saat diimpor oleh pengujian,
// tidak ada efek samping: tanpa koneksi DB dan tanpa prompt password.
const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(`gagal: ${describeError(error)}`);
    process.exitCode = 1;
  }
}

// Diekspor HANYA agar dapat diuji tanpa database (lihat scripts/__tests__).
export {
  BCRYPT_COST,
  EMAIL_SCHEMA,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  NAME_SCHEMA,
  SafeCliError,
  describeError,
  parseArgs,
};
