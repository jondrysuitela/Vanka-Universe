# Rencana Implementasi PostgreSQL/Neon — Fondasi Autentikasi (Tahap 4G.16)

> **Status dokumen: RENCANA. Belum ada satu pun langkah yang dijalankan.**
> Tidak ada project Neon, database, bucket R2, atau resource cloud apa pun yang dibuat.
> Tidak ada schema/migration yang diterapkan. Tidak ada akun owner yang dibuat.
> Tidak ada rahasia/kredensial di dokumen ini atau di repository.

Legenda label yang dipakai di seluruh dokumen:

| Label | Arti |
|---|---|
| **[FAKTA]** | Terverifikasi langsung dari kode/konfigurasi di repository ini. |
| **[RENCANA]** | Langkah yang disusun tetapi **belum dijalankan**. |
| **[BELUM DIUJI]** | Perilaku yang **belum** diuji; jangan dianggap bekerja. |
| **[PERLU IZIN]** | Tindakan yang menuntut persetujuan eksplisit pemilik proyek (DB/cloud/rahasia). |

---

## 1. Arsitektur koneksi

**[FAKTA]** `src/lib/db.ts` sudah menyediakan abstraksi driver eksplisit:

- `DRIVER_VALUES = ["pg", "neon"]` (`db.ts:28`).
- `DB_DRIVER` **wajib**; nilai kosong/tidak dikenal → `resolveDriver()` melempar error (fail fast, `db.ts:46-55`). **Tidak ada** fallback diam-diam.
- Driver `"pg"` → `new PgPool({ connectionString, max: 5 })` (`db.ts:63-66`), koneksi TCP biasa (lokal).
- Driver `"neon"` → `new NeonPool({ connectionString, max: 5 })` (`db.ts:63-64`) dari `@neondatabase/serverless`.
- Pool dibuat **lazy** (`getPool()`, `db.ts:69-75`): mengimpor modul tidak membuka koneksi.
- `DATABASE_URL` wajib; bila kosong → error generik "Database is not configured on this server." (`db.ts:58-62`), tanpa membocorkan detail.
- `import "server-only"` (`db.ts:1`) → `pg`/`server-only` tidak bisa masuk bundle klien.
- DATE (OID 1082) di-parse sebagai string `'YYYY-MM-DD'` khusus driver `pg` (`db.ts:44`) — agar konsisten dengan kontrak `memory_date` di `src/lib/memories/repository.ts`.

**[FAKTA]** Dependency sudah ada, **tidak perlu dependency baru**:
`@neondatabase/serverless ^1.2.0`, `pg ^8.23.1`, `@types/pg ^8.23.1`, `bcryptjs ^3.0.3`, `zod ^4.6.5`, `server-only ^0.0.1` (`package.json`).

**[BELUM DIUJI]** Koneksi nyata ke Neon (TLS, pooling, latensi, batas koneksi) **belum pernah** dijalankan. `@neondatabase/serverless` v1.x mengirim query lewat transport HTTP/WebSocket, **bukan** TCP; kompatibilitas runtime dengan alur `BEGIN`/`COMMIT` + `pool.query` aplikasi ini belum terbukti.

**[BELUM DIUJI] / RISIKO ARSITEKTUR]** `db.ts` mengimpor **keduanya** (`pg` dan `@neondatabase/serverless`) secara statis (`db.ts:3-4`). Pada runtime Cloudflare Workers (tanpa TCP), `pg` tidak dapat berjalan; bundling dapat gagal atau berjalan tapi menganggur. Lihat §9.

**Bentuk koneksi [RENCANA]:**
- Lokal: `DB_DRIVER=pg` + connection string ke PostgreSQL lokal.
- Neon: `DB_DRIVER=neon` + connection string Neon. Untuk runtime serverless, gunakan endpoint **pooled** (host memuat `-pooler`); untuk migration/skrip administratif, gunakan endpoint **direct**. **[BELUM DIUJI]**: performa & kebenaran pemilihan endpoint pada skenario nyata.

---

## 2. Environment variable

Nama variabel saja — **tanpa nilai**:

| Variabel | Wajib? | Fungsi (dari kode) |
|---|---|---|
| `DB_DRIVER` | **wajib** | `"pg"` (lokal, TCP) atau `"neon"` (Neon). `db.ts:46-55`. |
| `DATABASE_URL` | **wajib** | Connection string server-side. `db.ts:58`. Tidak pernah dikirim ke klien. |
| `APP_ORIGIN` | opsional | Origin tepercaya untuk CSRF; fallback ke origin request. `src/lib/auth/guard.ts:58`. |
| `BCRYPT_COST` | opsional | Cost bcrypt; default **12** bila tidak diatur (`src/lib/auth/password.ts:7`). |
| `NODE_ENV` | framework | Menentukan flag `Secure` pada cookie sesi (`session.ts:160`). |

**[FAKTA]** Tidak ada berkas `.env*` di repository saat ini (tidak dibuat pada tahap ini).

**[RENCANA]** Cara menaruh konfigurasi **tanpa kredensial di repository**:
1. Lokal: simpan di `.env.local` (sudah diabaikan `.gitignore` bila tercantum; **verifikasi sendiri** sebelum menulis kredensial).
2. Neon/produksi: setel lewat dashboard/secret store platform hosting.
3. **[PERLU IZIN]** Kredensial hanya disentuh operator; skrip/agen tidak membaca `.env*`.

**[FAKTA]** `scripts/create-owner.mjs` **tidak** membaca berkas `.env`; ia hanya memakai `process.env.DATABASE_URL`.

---

## 3. Kebutuhan skema vs kode (final review)

### 3.1 `admins.password_hash`

| Aspek | Nilai | Bukti |
|---|---|---|
| Tipe | `text` | `draft_migration_4c2a_auth_foundation.sql:38-39` |
| Nullability | `NULL` diizinkan | idem (agar baris lama tetap valid) |
| Pemakaian kode | `SELECT id, email, name, role, is_active, password_hash FROM admins WHERE email = $1` | `src/app/api/auth/login/route.ts:29-31` |
| Perilaku NULL | `NULL` → `burnDummyComparison` → login ditolak (401 generik, anti-enumeration) | `login/route.ts:72-77` |
| Sumber | Hanya draft migration; **tidak ada** di `db/schema.sql`, `db/init.sql`. Mulai 4G.17 **didokumentasikan** di `db/SCHEMA.md` | verifikasi grep + `db/SCHEMA.md` §1 |

### 3.2 `sessions`

Kolom (dari `draft_migration_4c2a_auth_foundation.sql:58-67`) vs pemakaian kode (`src/lib/auth/session.ts`):

| Kolom | Tipe (draft) | Dipakai kode | Bukti |
|---|---|---|---|
| `id` | `uuid` PK | ya | `session.ts:70,86-87` |
| `admin_id` | `uuid NOT NULL` FK → `admins(id) ON DELETE CASCADE` | ya | `session.ts:51,72,107` |
| `token_hash` | `varchar(64) NOT NULL UNIQUE` | ya (SHA-256 hex = 64 char) | `session.ts:27-29,48,73,98` |
| `expires_at` | `timestamptz NOT NULL` | ya | `session.ts:52,75,85` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | ya (deadline absolut 30 hari) | `session.ts:77,85` |
| `revoked_at` | `timestamptz NULL` | ya | `session.ts:78,108,121,137` |
| `ip_address` | `varchar(100) NULL` | ya | `session.ts:51-53` |
| `user_agent` | `text NULL` | ya | `session.ts:51-53` |

Kebijakan sesi **[FAKTA]** (`session.ts`): token acak 32 byte (hex), hanya hash SHA-256 yang disimpan; validasi menuntut `revoked_at IS NULL` **dan** `expires_at > now()` **dan** `admins.is_active = true` **dan** `created_at + 30 days > now()`; pembaruan sliding `LEAST(now() + 7d, created_at + 30d)`; cookie `vanka_session` `HttpOnly` + `SameSite=Lax` + `Secure` hanya bila `NODE_ENV=production`, `maxAge` 30 hari.

Indeks (draft:76-88): `idx_sessions_admin` (penuh), `idx_sessions_admin_active` (partial `WHERE revoked_at IS NULL`), `idx_sessions_expires_at` (partial). UNIQUE `token_hash` dari constraint kolom.

### 3.3 `login_attempts`

| Kolom | Tipe (draft:119-125) | Dipakai kode | Bukti |
|---|---|---|---|
| `email` | `varchar(255) NOT NULL` | ya | `rate-limit.ts` |
| `ip_address` | `varchar(100)` (**nullable**) | ya (`null` = IP tidak dipercaya) | `rate-limit.ts` |
| `success` | `boolean NOT NULL DEFAULT false` | ya | `rate-limit.ts` |
| `attempted_at` | `timestamptz NOT NULL DEFAULT now()` | ya | `rate-limit.ts` |

Aturan **[FAKTA]**: 5 kegagalan per email+IP / 20 kegagalan per IP dalam 15 menit → 429. Bila IP
klien tidak dapat dipercaya (tidak ada `ARCHIVE_TRUSTED_PROXY_HEADER` yang dikonfigurasi),
guard per-IP dilewati dan kegagalan dihitung pada bucket **identity-only per email**
(`ip_address IS NULL`), sehingga tebakan tetap dibatasi tanpa satu klien mengunci akun orang lain.
Login sukses menghapus baris gagal (email+IP, atau bucket identity-only bila IP tak dikenal) lalu
menambah baris sukses.

Indeks: `idx_login_attempts_email_ip_time(email, ip_address, attempted_at DESC)`,
`idx_login_attempts_email_null_ip_time(email, attempted_at DESC) WHERE ip_address IS NULL`,
`idx_login_attempts_ip_time(ip_address, attempted_at DESC)`.

**[PERBAIKAN]** Kolom `ip_address` sebelumnya dideklarasikan `NOT NULL` sementara kode menyimpan
`""` untuk IP tak dikenal. Itu menggabungkan semua klien tanpa IP tepercaya ke satu bucket
bersama — satu klien bisa mengunci login seluruh orang. Kolom kini nullable dan kode menyimpan
`NULL` (bucket identity-only per email). Sumber IP: hanya header yang dinyatakan operator lewat
`ARCHIVE_TRUSTED_PROXY_HEADER`; `x-forwarded-for` mentah tidak lagi dipakai.

**[FAKTA] Cacat dokumentasi (bukan kode):** sebelumnya `db/SCHEMA.md` **belum** memuat `sessions`, `login_attempts`, atau `admins.password_hash`. **Diselaraskan pada Tahap 4G.17**: `db/SCHEMA.md` kini mendokumentasikan ketiganya beserta constraint/indeks/FK, perilaku expiry & revokasi, serta koreksi klaim indeks `audit_logs` yang salah. SQL/migration **tidak** diubah.

### 3.4 Ketergantungan urutan

**[FAKTA]** Draft memakai `uuid_generate_v4()` sebagai default PK (`draft:59,120`) dan FK ke `admins` (`draft:60`) → **wajib** `db/schema.sql` (extension `uuid-ossp` + tabel `admins`) dan `db/init.sql` (trigger) diterapkan lebih dulu.

**[BELUM DIUJI]** Ketersediaan extension `uuid-ossp` di Neon dan hak `CREATE EXTENSION`. Neon mendukung `uuid-ossp`, tetapi **belum diverifikasi di project ini**. Alternatif: `gen_random_uuid()` (memerlukan `pgcrypto`, biasanya tersedia) — **perubahan skema, di luar cakupan tahap ini**.

---

## 4. Risiko migration (IF NOT EXISTS, drift, pengulangan, rollback)

**[FAKTA]** Draft memakai `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `COMMENT ON ...` dalam satu `BEGIN`/`COMMIT` (draft:31,153).
- `IF NOT EXISTS` hanya mencocokkan **nama** objek. Objek pra-ada dengan definisi berbeda **dilewati senyap** tanpa peringatan (dinyatakan sendiri di draft:14-17).
- Tidak ada tabel versi/riwayat migration → tidak ada cara mengetahui apakah migration pernah diterapkan, atau diterapkan sebagian.
- Tidak ada skrip rollback.
- `COMMENT ON` idempoten (aman diulang). `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` aman diulang.
- DDL PostgreSQL transaksional; `psql --single-transaction` menambah jaminan bila berkas diedit.

**Konsekuensi [FAKTA]:** "berhasil tanpa error" **tidak** membuktikan struktur cocok. Drift harus dibuktikan lewat query `information_schema`/`pg_indexes` di `db/MIGRATION_CHECKLIST.md` (§5).

**Skenario drift konkret yang harus dicegah:**
- `admins.password_hash` ada tetapi tipe bukan `text` → `CREATE` dilewati; verifikasi tipe wajib.
- `sessions` ada tetapi tanpa `created_at` → query `session.ts:77/85` gagal saat runtime.
- `token_hash` bukan UNIQUE → token bisa duplikat (cacat keamanan).
- FK tanpa `ON DELETE CASCADE` → perilaku berbeda dari rencana.
- Indeks partial hilang → performa turun (bukan kegagalan fungsi).

**Pemulihan [RENCANA, BELUM DIJALANKAN]:** gunakan **snapshot/branch** sebelum migration (Neon mendukung branching — **belum diuji** di project ini). Rollback manual (`DROP TABLE sessions`, `DROP TABLE login_attempts`, `ALTER TABLE admins DROP COLUMN password_hash`) **hanya didokumentasikan** di `db/MIGRATION_CHECKLIST.md` Phase 5; **tidak ada** yang dijalankan dan **tidak boleh** dijalankan tanpa [PERLU IZIN].

---

## 5. Urutan penerapan (diskema + migration)

**[RENCANA — BELUM DIJALANKAN]** Urutan wajib:

1. Siapkan instance PostgreSQL (lokal untuk uji; Neon untuk produksi). **[PERLU IZIN]** untuk membuat resource Neon.
2. `db/schema.sql` — extension `uuid-ossp`, tabel `admins`, `memories`, `media`, `birthday_editions`, `content`, `audit_logs`, indeks.
3. `db/init.sql` — fungsi `update_updated_at_column`, `audit_logs_no_mod`; trigger `trg_admins_updated_at`, `trg_memories_updated_at`, `trg_media_updated_at`, dll.
4. `db/draft_migration_4c2a_auth_foundation.sql` — satu transaksi:
   `psql --single-transaction -f db/draft_migration_4c2a_auth_foundation.sql`
5. **Verifikasi wajib** (baca-saja, §6). Bila ada ketidakcocokan → **STOP**.

**Kondisi STOP eksplisit:**
- Extension `uuid-ossp` atau tabel `admins` tidak ada.
- Ada error SQLSTATE apa pun (transaksi rollback → jangan lanjut sebagai "berhasil").
- Kolom/tipe/nullability tidak cocok dengan §3.
- `sessions.token_hash` bukan UNIQUE; FK bukan `ON DELETE CASCADE`.
- Indeks wajib hilang.
- Sudah ada >1 owner aktif di `admins`.

---

## 6. Checklist verifikasi skema setelah migration

**[FAKTA]** Sudah disusun lengkap di `db/MIGRATION_CHECKLIST.md` (Phase 1-5): query `information_schema.columns`, `information_schema.table_constraints` + `key_column_usage` + `constraint_column_usage` + `referential_constraints` (FK, termasuk `delete_rule`), UNIQUE `token_hash` yang dibatasi ke tabel `sessions`, dan `pg_indexes` untuk `sessions` + `login_attempts`.

**[RENCANA]** Jalankan seluruh checklist itu dan simpan keluarannya sebagai bukti. **[BELUM DIUJI]**: belum ada query yang dijalankan pada DB nyata.

---

## 7. Prosedur pembuatan owner & pengujian login

**[RENCANA — BELUM DIJALANKAN]**

1. Pastikan §5 langkah 1-5 selesai dan verifikasi §6 lulus.
2. Setel `DB_DRIVER=pg` (lokal) atau `neon`, dan `DATABASE_URL`, di environment proses. **[PERLU IZIN]** untuk menyentuh berkas/secret.
3. `node scripts/create-owner.mjs <email> <name>` — meminta password secara tersembunyi, bcrypt cost 12, menolak bila sudah ada owner aktif, menutup pool di semua jalur keluar.
4. Verifikasi baris: `SELECT email, role, is_active, length(password_hash), substr(password_hash,1,4) FROM admins WHERE role='owner';` → `role='owner'`, `is_active=true`, panjang 60, prefiks `$2a`/`$2b` (bcrypt). Jangan mencetak `password_hash` penuh.
5. Uji login (butuh header CSRF; lihat `guard.ts:52-71`):
   `POST /api/auth/login` dengan `Content-Type: application/json`, `Origin` yang benar, `x-vanka-request: 1`, body `{ "email": "...", "password": "..." }` → 200 + `Set-Cookie: vanka_session`.
6. `GET /api/auth/me` dengan cookie → 200 berisi `admin` (id, email, name, role) (`me/route.ts:6-13`).
7. `POST /api/auth/logout` dengan cookie + header CSRF → 200, cookie dikosongkan (`logout/route.ts:7-19`).

**[BELUM DIUJI]** Skrip owner belum pernah dieksekusi terhadap DB. Alur `main()` (guard advisory lock `pg_advisory_xact_lock`, `INSERT ... ON CONFLICT ... RETURNING`, pemetaan SQLSTATE) hanya diuji lewat unit/smoke tanpa DB.

**[BELUM DIUJI] — peringatan eksplisit:** penyamaran input password di terminal (raw TTY + cek `stdin.isRaw`) **belum pernah** diuji di Windows pada lingkungan nyata. Mekanismenya memakai `setRawMode` (API publik) dan skrip **berhenti** bila verifikasi gagal; fallback = stdin non-TTY. Jangan mengklaim tersembunyi-terverifikasi sebelum diuji manual.

---

## 8. Tes yang harus lulus sebelum melanjutkan

**[FAKTA — sudah lulus]**
- 4G.15: `vitest run` → **163/163** (15 berkas). 4G.18: → **181/181** (16 berkas). 4G.19: → **187/187** (17 berkas). 4G.20: → **198/198** (17 berkas), termasuk `scripts/__tests__/create-owner.test.ts` (19), `src/lib/auth/__tests__/admin-security.test.ts` (9), `src/lib/auth/__tests__/session.test.ts` (15), `src/app/api/auth/__tests__/auth.routes.test.ts` (15), `src/app/api/media/__tests__/media.routes.test.ts` (26, +11 untuk policy role 4G.20), `src/app/api/memories/__tests__/memories.routes.test.ts` (30, tidak regresi), dan `src/app/admin/__tests__/protected-layout.test.ts` (6).
- `eslint` bersih pada berkas yang diubah (4G.15/4G.18/4G.19/4G.20). 4G.19 smoke dev: `/admin*` tanpa cookie → **307** ke `/admin/login`; `/admin/login` → **200**. 4G.20 smoke dev: `GET /api/media` & `GET/DELETE /api/media/[id]` tanpa sesi → **401**; `POST /api/media` tanpa CSRF → **403**; cookie bogus tanpa DB → **500** (fail-closed, tanpa data).
- Catatan: `tsc --noEmit` memunculkan error pra-eksisting di `.next/dev/types/validator.ts`, `scripts/__tests__/create-owner.test.ts`, `src/lib/media/__tests__/{metadata,store}.test.ts` (Buffer vs BlobPart / implicit any). Setelah pemindahan berkas ke route group `(protected)` pada 4G.19, `.next/types/validator.ts` (artefak lama, mtime pra-4G.19) masih menunjuk path lama → TS2307. Artefak dev yang benar (`.next/dev/types/validator.ts`) **sudah** memuat `(protected)`; noise ini hilang setelah `next build` berikutnya (tidak dijalankan di tahap ini).

**[RENCANA — belum dijalankan, wajib lulus sebelum lanjut]**
- Verifikasi §6 pada DB nyata (semua query cocok).
- Login sukses → 200 + cookie; password salah → 401 `INVALID_CREDENTIALS`; `is_active=false` → 401; `password_hash=NULL` → 401.
- 6 kegagalan beruntun email+IP → 429 `RATE_LIMITED`; 21 kegagalan dari IP sama → 429.
- `logout` → cookie kosong; `me` tanpa cookie → 401 `UNAUTHORIZED`.
- Revokasi sesi (`UPDATE sessions SET revoked_at = now() ...`) → `me` menjadi 401.
- Kedaluwarsa absolut 30 hari (`created_at + interval '30 days'`) → 401.
- Semua endpoint di atas menolak tanpa header CSRF dengan 403 `ORIGIN_REJECTED`/`CONTENT_TYPE_REJECTED`/`CSRF_HEADER_REJECTED`.

---

## 9. Penanganan kegagalan & seeding produksi

**[FAKTA]** Route login/logout/me menangkap error dan membalas 500 generik tanpa detail internal (`login/route.ts:95-98`, `logout/route.ts:15-18`, `me/route.ts:10-13`). `ApiError` → respons terstruktur.

**Rencana kegagalan [RENCANA]:**
- `DB_DRIVER` tak diatur → semua API DB 500 → periksa konfigurasi environment.
- Koneksi gagal (Neon: TLS/endpoint salah, IP allow-list) → 500; diagnosis lewat log server (jangan cetak `DATABASE_URL`).
- Migration gagal → transaksi rollback; **jangan** mengulang tanpa memeriksa drift (§4).
- Sesi lama tetap hidup setelah `is_active=false` atau ganti password **via SQL manual** (tidak ada auto-revoke otomatis di kode). **4G.18**: helper atomik tersedia (`deactivateAdminAndRevokeSessions`, `setAdminPasswordHashAndRevokeSessions`, `revokeAllSessionsExcept` — lihat §12), tetapi **belum ada route** yang memanggilnya, jadi jalur HTTP masih belum ada. Sementara ini prosedur manual: `UPDATE sessions SET revoked_at = now() WHERE admin_id = $1 AND revoked_at IS NULL`.

---

## 10. Batasan yang belum diuji pada Cloudflare Workers/OpenNext

**[FAKTA]** Repository **tidak** memuat adapter Workers/OpenNext, `wrangler`, maupun `output: "standalone"`. `next.config.ts` hanya memuat `cacheComponents: true`, `partialPrefetching: true`, dan aturan turbopack CSS. `package.json` tidak memuat `@opennextjs/cloudflare`, `wrangler`, atau SDK storage R2.

**[BELUM DIUJI] — daftar risiko yang harus diuji di runtime Workers:**
1. `pg` (node-postgres) memerlukan TCP mentah → umumnya **tidak** jalan di Workers. `db.ts:3` mengimpornya statis; perlu verifikasi bundling/pengecualian.
2. `@neondatabase/serverless` di Workers memakai HTTP/WebSocket. Di Node, `CONFIG.md` menyebut `webSocketConstructor` bila global `WebSocket` tidak ada; Node 24 menyediakannya, tetapi perilaku di Workers **belum diuji**.
3. `node:crypto` (`createHash`, `randomBytes`, `session.ts:1`) di Workers hanya didukung sebagian → **belum diuji**.
4. `server-only` (`db.ts:1`) dan `bcryptjs` (JS murni) → perlu verifikasi bundle.
5. `cacheComponents: true` + route handler yang bergantung sesi: perilaku cache/eksekusi **belum diuji** di runtime edge.
6. Cookie `Secure` bergantung `NODE_ENV` → pastikan produksi benar-benar `production`.

---

## 11. Tahapan lanjutan (setelah login terbukti)

**[FAKTA — 4G.19]**
- **Route guard `/admin/*` SUDAH DITERAPKAN** (server-side, bukan middleware/client): route group `src/app/admin/(protected)/layout.tsx` (Server Component) memvalidasi cookie `vanka_session` lewat `getSessionAdmin`; tanpa sesi valid → `redirect("/admin/login")`. Halaman login ada **di luar** grup sehingga tetap publik dan tidak ada loop. Fail-closed: error DB saat validasi = "tanpa sesi" (redirect + `console.error`), tidak pernah dianggap terautentikasi.
- **Role**: `src/lib/memories/policy.ts` sudah menjadi kontrak peran untuk Memories (owner/admin = operator; editor terbatas; delete hanya operator → 403, baris tak terlihat → 404). Untuk Memories, `requireRole()` **tidak** dipakai karena `policy.ts` membawa semantik lebih kaya (404 untuk baris tersembunyi). Untuk **Media (4G.20)** kontrak peran eksplisit tersedia di `src/lib/media/policy.ts` dan ditegakkan dengan `requireRole(admin, MEDIA_OPERATOR_ROLES)` — lihat §11.
- Tidak ada berkas `middleware.ts`/`proxy.ts`, jadi strategi memakai layout Server Component (didukung Next 16 App Router), bukan middleware.

**[RENCANA — masih terbuka]**
- **Guard API tetap wajib** dan sudah ada (`requireSession` di setiap route sensitif); guard halaman **tidak** menggantikan guard API.
- **Media**: **policy peran diterapkan (Tahap 4G.20)**. Keputusan pemilik proyek: `owner`/`admin` = operator (view/upload/edit/delete); `editor` ditolak (403) untuk view/upload/edit/delete; role tak dikenal ditolak. Implementasi: `src/lib/media/policy.ts` (`MEDIA_OPERATOR_ROLES = ["owner","admin"]`) + `requireRole(admin, MEDIA_OPERATOR_ROLES)` di kelima handler media (`GET`/`POST /api/media`, `GET`/`PATCH`/`DELETE /api/media/[id]`). Role selalu dari sesi server. Memories **tidak** diubah.
- **Persistensi surat**: saat ini hanya `localStorage` (`vanka.letters.v2`) — risiko kehilangan data; perlu tabel (mis. `content` `type='letter'`) + migration baru non-destruktif.
- **Media R2**: saat ini media disimpan di filesystem `storage/media/index.json` (`src/lib/media/store.ts`), **bukan** R2. Tabel `media` di `schema.sql` belum terhubung ke kode. Belum ada SDK/bucket R2.
- **Arsip privat**: konfigurasi hanya draft `localStorage` (`src/lib/archive/draft.ts`); belum ada route tersimpan, PIN, atau aset audio.
- **Reference probe media**: `src/lib/media/references.ts` masih **nol** probe terdaftar → penghapusan media fail-closed (`409 REFERENCE_UNVERIFIED`) sampai ada sumber referensi persisten.

---

## 12. Revokasi sesi & penguatan validasi (Tahap 4G.17 desain → Tahap 4G.18 **diimplementasikan, diuji unit**)

**[FAKTA] Diimplementasikan pada Tahap 4G.18** (diuji dengan fake pool; **belum** diuji terhadap DB nyata):
- Validasi + renewal sesi kini **atomik**: satu statement CTE `WITH renewed AS` mencakup semua guard dan perpanjangan sliding (`src/lib/auth/session.ts:69-97`). Menghapus jendela TOCTOU dua-statement sebelumnya. Sesi yang dicabut tidak dapat dihidupkan/diperpanjang.
- Helper baru `revokeAllSessionsExcept(adminId, keepSessionId)` (`session.ts:132-141`, hanya kolom `sessions.id` — **tanpa kolom baru**).
- Helper atomik baru di `src/lib/auth/admin-security.ts`: `deactivateAdminAndRevokeSessions(adminId)` dan `setAdminPasswordHashAndRevokeSessions(adminId, passwordHash)`. Keduanya satu statement CTE (implicit transaction) → nonaktifkan/hash-password **dan** revokasi sesi berlaku bersama atau tidak sama sekali. `DbPool` hanya punya `query()` dan pool `max:5`, jadi BEGIN/COMMIT lintas panggilan **tidak** aman → CTE satu-statement adalah cara aman yang dipilih.
- Kegagalan DB selalu reject (tidak ditelan); cookie logout hanya dibersihkan setelah revokasi sukses (`logout/route.ts:11-13`).

**[FAKTA] Masih sama / belum berubah:**
- `is_active=false` via SQL manual masih hanya berefek lewat filter validasi; sekarang juga durabel bila lewat helper deaktivasi.
- `requireRole()` (`guard.ts:88-95`) tetap **tidak dipanggil** route mana pun → role belum ditegakkan.
- **Belum ada route manajemen admin** → ketiga helper baru tidak dipicu lewat HTTP.
- Tidak ada auto-revoke otomatis (tidak ada event hook) — pemanggilan helper masih tanggung jawab route yang belum dibuat.

**[KEPUTUSAN DESAIN]**
1. **Logout sesi saat ini**: `revokeSession(token)`; cookie dikosongkan **hanya setelah** UPDATE sukses; gagal → 5xx, bukan klaim berhasil.
2. **Cabut semua sesi satu admin**: `revokeAllSessions(adminId)`.
3. **Nonaktifkan admin**: `deactivateAdminAndRevokeSessions(adminId)` (atomik).
4. **Ganti/reset password**: reset → `setAdminPasswordHashAndRevokeSessions(adminId, hash)` (cabut semua); ganti mandiri → `revokeAllSessionsExcept(adminId, currentSessionId)` untuk mempertahankan sesi saat ini.
5. **Status admin diperiksa di setiap validasi sesi**: ya, di dalam CTE dan pada JOIN (`session.ts:81-90`).
6. **Error database saat revokasi**: selalu fail-closed — 5xx, jangan hapus cookie sebagai "bukti" logout, jangan pernah klaim tercabut bila UPDATE gagal.
7. **Audit tindakan keamanan**: **BELUM BISA**. `audit_logs.chk_audit_entity` hanya mengizinkan `memory|media|birthday_edition|content`, tidak `admin`/`session` → butuh perubahan skema terpisah. **Keputusan: tunda.**
8. **Dampak pada sesi berjalan**: `is_active` dan `revoked_at` berlaku pada request berikutnya; TOCTOU sudah dihapus oleh validasi atomik. Tidak perlu blacklist token.

**[KETERGANTUNGAN SKEMA/MIGRATION]**: helper 1-6 hanya butuh tabel `sessions` + `admins.password_hash` dari `db/draft_migration_4c2a_auth_foundation.sql` (**belum dijalankan**). Keputusan 7 menuntut perubahan `chk_audit_entity` (ditunda).

**[RISIKO BELUM TERSELESAIKAN]**: tidak ada route manajemen admin (helper belum terpakai); role belum ditegakkan; drift `IF NOT EXISTS`; retensi `login_attempts`; semua helper **belum** diuji terhadap PostgreSQL nyata.

**[TES 4G.18 — SUDAH DITAMBAHKAN & LULUS (mock, tanpa DB)]**: validasi+renewal satu statement & guard lengkap; error DB pada validasi → reject (bukan sesi valid); `revokeSession` hanya `token_hash`; `revokeAllSessions` scope `admin_id`+`revoked_at IS NULL`; `revokeAllSessionsExcept` menyisakan `id <> $2`; error DB pada revokasi diteruskan; `deactivateAdminAndRevokeSessions`/`setAdminPasswordHashAndRevokeSessions` satu statement + propagasi error + tolak hash kosong; logout gagal-DB → 500 tanpa clear cookie; me gagal-DB → 500; sesi dicabut/nonaktif → 401.

**[TES YANG MASIH WAJIB SEBELUM PRODUKSI]**: verifikasi terhadap DB nyata bahwa CTE benar-benar atomik & kolom/constraint cocok; tes integrasi route manajemen admin begitu dibuat; tes end-to-end login→deaktivasi→401.

**[URUTAN IMPLEMENTASI AMAN]**: (1) migration diterapkan + verifikasi checklist §6; (2) tes regresi `is_active` terhadap DB; (3) route manajemen admin yang memanggil helper atomik; (4) tes integrasi gagal-DB fail-closed; (5) baru pertimbangkan audit (perubahan skema terpisah). Semua langkah menuntut **[PERLU IZIN]** untuk akses DB.

---

## 13. Ringkasan label

- **[FAKTA]** skema draft cocok dengan query kode; dependency Neon & `pg` sudah ada; CSRF/sesi/rate-limit pada route auth sesuai kode; `db/SCHEMA.md` kini selaras dengan skema/migration (diperbarui 4G.17, perilaku sesi 4G.18); tidak ada adapter Workers; tidak ada `.env*`; `pg` diimpor statis bersama driver Neon; validasi+renewal sesi kini atomik dan helper revokasi atomik tersedia (diuji unit 4G.18); **guard halaman `/admin/*` sudah server-side** lewat route group `(protected)` (4G.19); **policy peran media sudah ditegakkan** di kelima endpoint media (4G.20); kontrak peran Memories sudah ditegakkan di `policy.ts`; `requireRole` dipakai untuk media, helper manajemen admin belum dipanggil route (lihat §11).
- **[RENCANA]** membuat DB/Neon, menyetel env, menerapkan 3 berkas SQL, verifikasi, membuat owner, menguji login, branch/snapshot untuk rollback, persistensi surat, R2, arsip privat.
- **[BELUM DIUJI]** koneksi Neon, `uuid-ossp` di Neon, pooling, runtime Workers/OpenNext, penyamaran password di TTY Windows, seluruh alur `main()` skrip owner terhadap DB.
- **[PERLU IZIN]** membuat resource Neon, menyentuh `.env`/secret, menjalankan SQL/migration, membuat akun owner, deploy.
