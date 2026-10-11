import type { SessionAdmin } from "@/lib/auth/session";
import type { MemoryPrivacy } from "@/lib/memories/schema";

/**
 * Access policy for Memories (Tahap 4D).
 *
 * Keputusan kebijakan yang dieksplisitkan di sini (bukan tersirat di UI):
 *
 * 1. Belum ada rute publik/anonymous. SEMUA endpoint Memories memerlukan
 *    session admin yang valid, terlepas dari nilai `privacy`. Nilai `public`
 *    saat ini hanya menandai keterlihatan ANTAR admin, bukan izin baca anonim.
 *    Membuka baca publik butuh kebijakan publik terpisah (belum disetujui) +
 *    rate limiting + jalur API khusus; sengaja TIDAK dibuat di tahap ini.
 *
 * 2. `shared` TIDAK berarti "boleh dibaca semua orang". Belum ada tabel
 *    grant/izin eksplisit untuk `shared`, sehingga baris `shared` hanya
 *    terlihat oleh owner/admin dan pembuat/pemilik baris itu sendiri.
 *
 * 3. Peran:
 *    - owner / admin : operator. Baca semua, tulis semua, hapus semua.
 *    - editor        : kontributor terbatas. Baca `public` milik siapa pun +
 *                      baris yang ia buat/ia miliki; ubah hanya baris
 *                      buatannya/miliknya; TIDAK boleh menghapus apa pun.
 *
 * 4. Baris yang tidak terlihat bagi aktor diperlakukan sebagai TIDAK ADA
 *    (404), bukan 403, agar keberadaan data tidak bocor.
 *    403 dipakai hanya untuk penolakan berbasis peran pada resource yang
 *    memang terlihat oleh aktor.
 */

type Role = SessionAdmin["role"];

const OPERATOR_ROLES: readonly Role[] = ["owner", "admin"];

export interface MemoryAccessRow {
  created_by: string | null;
  owner_id: string | null;
  privacy: MemoryPrivacy;
}

export function isOperator(admin: SessionAdmin): boolean {
  return OPERATOR_ROLES.includes(admin.role);
}

/**
 * Rute publik/anonymous sengaja tidak diimplementasikan pada tahap ini.
 * Nilai false adalah fakta, bukan toggle: tidak ada jalur baca anonim.
 */
export const ANONYMOUS_READ_ENABLED = false;

export function canCreateMemory(admin: SessionAdmin): boolean {
  // Semua peran terautentikasi boleh membuat kenangan; identitas pembuat
  // selalu diambil dari session, bukan dari body klien.
  void admin;
  return true;
}

export function canUpdateMemory(admin: SessionAdmin, row: MemoryAccessRow): boolean {
  if (isOperator(admin)) return true;
  return row.created_by === admin.id || row.owner_id === admin.id;
}

export function canDeleteMemory(admin: SessionAdmin): boolean {
  return isOperator(admin);
}

/**
 * Filter visibilitas baca, dieksekusi di DATABASE (parameterized).
 * Owner/admin tidak butuh filter: mereka melihat semua baris.
 *
 * Mengembalikan SQL mentah yang mengacu pada `$N` yang diberikan, sehingga
 * caller WAJIB memasukkan `adminId` ke params pada posisi `idParamIndex`.
 * Mengembalikan null bila tidak ada filter yang diperlukan.
 *
 * `public` terlihat semua admin terautentikasi (bukan anonim); `private` dan
 * `shared` hanya baris yang dibuat/dimiliki editor tersebut — belum ada grant
 * eksplisit untuk `shared`.
 */
export function memoryReadScopeSql(admin: SessionAdmin, idParamIndex: number): string | null {
  if (isOperator(admin)) return null;
  const p = `$${idParamIndex}`;
  return `privacy = 'public' OR created_by = ${p} OR owner_id = ${p}`;
}

/** Wrapper 404-when-hidden for readability at call sites. */
export function isRowVisibleTo(admin: SessionAdmin, row: MemoryAccessRow): boolean {
  if (isOperator(admin)) return true;
  if (row.created_by === admin.id || row.owner_id === admin.id) return true;
  return row.privacy === "public";
}
