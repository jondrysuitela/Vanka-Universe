# Vanka Universe — Dokumentasi Skema PostgreSQL

> **Status penerapan: BELUM DITERAPKAN.** Tidak ada database (lokal maupun Neon) yang
> dikonfigurasi, dan **tidak ada** migration yang dijalankan. Dokumen ini menjelaskan
> skema yang **didefinisikan di berkas** (`db/schema.sql`, `db/init.sql`,
> `db/draft_migration_4c2a_auth_foundation.sql`), bukan skema yang sudah diverifikasi
> berjalan di database nyata. Verifikasi runtime ada di `db/MIGRATION_CHECKLIST.md`.
>
> Diperbarui: Tahap 4G.17 (penyelarasan dokumentasi dengan skema aktual + auth draft).
> Tahap 4G.29 menambahkan §4c (keputusan terbuka domain `audit_logs`).

## Sumber kebenaran (urutan penerapan)

| Urutan | Berkas | Isi | Status |
|---|---|---|---|
| 1 | `db/schema.sql` | Extension `uuid-ossp`, tabel: `admins`, `memories`, `media`, `birthday_editions`, `content`, `audit_logs` + indeks | Ditetapkan di berkas; **belum dijalankan** |
| 2 | `db/init.sql` | Fungsi `update_updated_at_column`, `audit_logs_no_mod` + trigger `updated_at` & append-only audit | Ditetapkan di berkas; **belum dijalankan** |
| 3 | `db/draft_migration_4c2a_auth_foundation.sql` | `admins.password_hash`, tabel `sessions`, tabel `login_attempts` | **DRAFT** — belum dijalankan, belum diuji |
| 4 | `db/draft_migration_4g26_birthday_letters.sql` | Tabel `birthday_letters` (`full_text` kanonik, `sections`/`thumbnail` JSONB, status default `draft`) + index + trigger | **DRAFT** — belum dijalankan, belum diuji |
| 5 | `db/draft_migration_4g27_private_archive.sql` | Tabel `private_archives` (`music_media_id` FK → `media`, status default `draft`) + perluasan aditif CHECK `media.media_type` (`audio`) + index + trigger | **DRAFT** — belum dijalankan, belum diuji |

Urutan **wajib** seperti di atas: draft migration memakai `uuid_generate_v4()` dan FK ke
`admins(id)`, sehingga **gagal** bila `schema.sql` (extension + tabel `admins`) belum diterapkan.
Jalankan draft dalam satu transaksi:
`psql --single-transaction -f db/draft_migration_4c2a_auth_foundation.sql`.

### Fresh install vs upgrade (Tahap 4G.24)

- **Fresh install** (database kosong): `schema.sql` → `init.sql` → draft migration.
- **Upgrade** (sudah ada `schema.sql`): draft migration bersifat **aditif** — menambah
  `admins.password_hash`, tabel `sessions`, dan tabel `login_attempts`; **tidak** mengubah atau
  menghapus data/tabel lama.
- Draft memakai `IF NOT EXISTS` yang hanya mencocokkan **nama**, bukan definisi. Karena itu draft
  kini memuat blok **PREFLIGHT** (`DO $preflight$`, dijalankan di dalam transaksi yang sama
  SEBELUM DDL) yang `RAISE EXCEPTION` bila ada objek pra-ada yang bertentangan: extension
  `uuid-ossp`/tabel `admins` hilang, `admins.email` tidak UNIQUE, `password_hash` bukan `text`,
  kolom wajib `sessions`/`login_attempts` hilang, atau `sessions.token_hash` tidak UNIQUE.
  Pelanggaran = transaksi rollback, tanpa DDL yang diterapkan.
- **Backup/rollback**: snapshot/backup (atau Neon branch) wajib sebelum menjalankan pada DB
  berisi data. Kegagalan di tengah = rollback otomatis (satu transaksi), tetapi transaksi
  **tidak** memperbaiki objek pra-ada yang definisinya berbeda. Rollback manual (`DROP`)
  destruktif dan hanya didokumentasikan di `db/MIGRATION_CHECKLIST.md` Phase 5.
- **BELUM DIUJI**: blok PREFLIGHT dan seluruh migration belum dijalankan/divalidasi terhadap
  PostgreSQL nyata.

---

## 1. `admins` — identitas admin (dasar + draft)

Dari `db/schema.sql`:

| Kolom | Tipe | Null | Default | Catatan |
|---|---|---|---|---|
| `id` | UUID | NO | `uuid_generate_v4()` | PK |
| `email` | VARCHAR(255) | NO | — | `UNIQUE` |
| `name` | VARCHAR(255) | NO | — | |
| `role` | VARCHAR(50) | NO | `'admin'` | CHECK `chk_admins_role`: `admin` \| `owner` \| `editor` |
| `is_active` | BOOLEAN | NO | `true` | Status akun. Akun **tidak dihapus**, dinonaktifkan |
| `last_login_at` | TIMESTAMPTZ | YES | — | Diperbarui route login (`login/route.ts:42-45`) |
| `created_at` | TIMESTAMPTZ | NO | `now()` | |
| `updated_at` | TIMESTAMPTZ | NO | `now()` | Trigger `trg_admins_updated_at` (`init.sql`) |

Tambahan dari **draft migration** (`draft:38-42`):

| Kolom | Tipe | Null | Catatan |
|---|---|---|---|
| `password_hash` | TEXT | YES | Hash bcrypt (cost 12). **NULL = login tidak diizinkan.** Tidak pernah menyimpan plaintext |

**Constraint/indeks**: PK `admins_pkey`; UNIQUE pada `email` (dasar untuk `ON CONFLICT (email)` di
`scripts/create-owner.mjs`). Tidak ada indeks tambahan pada `admins`.

**Catatan operasional**: `password_hash` **tidak ada** di `schema.sql`/`init.sql`. Tanpa draft
migration, `SELECT ... password_hash FROM admins` (`login/route.ts:30`) akan gagal.

---

## 2. `sessions` — sesi admin server-side (DRAFT saja)

**Tabel ini hanya ada di draft migration** (`draft:58-67`), bukan di `schema.sql`/`init.sql`.

| Kolom | Tipe | Null | Default | Catatan |
|---|---|---|---|---|
| `id` | UUID | NO | `uuid_generate_v4()` | PK |
| `admin_id` | UUID | NO | — | FK → `admins(id)` **ON DELETE CASCADE** |
| `token_hash` | VARCHAR(64) | NO | — | `UNIQUE`. SHA-256 hex (tepat 64 char) dari token |
| `expires_at` | TIMESTAMPTZ | NO | — | Batas sliding (lihat §6) |
| `created_at` | TIMESTAMPTZ | NO | `now()` | Anchor batas absolut 30 hari |
| `revoked_at` | TIMESTAMPTZ | YES | — | NULL = belum dicabut |
| `ip_address` | VARCHAR(100) | YES | — | |
| `user_agent` | TEXT | YES | — | |

**Constraint**: PK `sessions_pkey`; UNIQUE `sessions_token_hash_key` pada `token_hash`;
FK `sessions_admin_id_fkey` → `admins(id)` `ON DELETE CASCADE`.

**Indeks** (`draft:76-88`):
- `idx_sessions_admin` — penuh pada `admin_id` (dipakai cascade & lookup per admin).
- `idx_sessions_admin_active` — partial `(admin_id) WHERE revoked_at IS NULL`.
- `idx_sessions_expires_at` — partial `(expires_at) WHERE revoked_at IS NULL`.

**Token**: token acak 32 byte → 64 hex dikirim ke klien lewat cookie; DB hanya menyimpan
hash SHA-256 (`session.ts:27-29`). Kebocoran DB tidak langsung memberi token yang bisa dipakai.

**Catatan penting**: token asli tidak dapat diambil kembali dari DB (hanya hash). Karena itu
"mencabut sesi" = mengisi `revoked_at`, bukan menghapus token.

---

## 3. `login_attempts` — rate limit login (DRAFT saja)

**Tabel ini hanya ada di draft migration** (`draft:119-125`).

| Kolom | Tipe | Null | Default | Catatan |
|---|---|---|---|---|
| `id` | UUID | NO | `uuid_generate_v4()` | PK |
| `email` | VARCHAR(255) | NO | — | Email yang dicoba (dinormalisasi lowercase oleh skema login) |
| `ip_address` | VARCHAR(100) | **YES** | — | IP klien yang **dapat dipercaya**; `NULL` = identitas tidak diketahui |
| `success` | BOOLEAN | NO | `false` | |
| `attempted_at` | TIMESTAMPTZ | NO | `now()` | Dasar sliding window |

**Indeks** (`draft:131-136`):
- `idx_login_attempts_email_ip_time` — `(email, ip_address, attempted_at DESC)`.
- `idx_login_attempts_email_null_ip_time` — `(email, attempted_at DESC) WHERE ip_address IS NULL`.
- `idx_login_attempts_ip_time` — `(ip_address, attempted_at DESC)`.

**Sumber IP**: hanya header yang dinyatakan operator lewat `ARCHIVE_TRUSTED_PROXY_HEADER` yang
dibaca. `x-forwarded-for` mentah bisa dipalsukan klien, sehingga tidak boleh dipercaya; tanpa
proxy teardown yang dikonfigurasi, IP dicatat `NULL` (**bukan** `""` — string kosong akan
menggabungkan semua klien tak dikenal ke satu bucket bersama).

**Aturan aplikasi** (`rate-limit.ts`): terkunci bila ≥5 kegagalan untuk email+IP yang
sama dalam 15 menit, **atau** ≥20 kegagalan dari IP yang sama dalam 15 menit. Bila IP tidak
diketahui, guard per-IP dilewati dan kegagalan dihitung pada bucket **identity-only per email**
(`ip_address IS NULL`) — tebakan tetap dibatasi, dan satu klien tak dikenal tidak pernah
mengunci akun orang lain. Login sukses menghapus baris gagal (email+IP, atau bucket identity-only
bila IP tak dikenal) lalu menambah baris sukses.

**Tidak ada** trigger append-only dan **tidak ada** retensi: tabel ini tumbuh tanpa batas
(dinyatakan di `draft:139-143`). Prune lama (>30 hari) masih rencana, belum ada penjadwalan.

---

## 4. Tabel lain (skema dasar)

Ringkas; sumber `db/schema.sql`.

### `memories`
`id` UUID PK · `title` VARCHAR(255) NOT NULL · `description` TEXT · `memory_date` DATE NOT NULL
(**tanggal kejadian**) · `category` VARCHAR(100) · `privacy` VARCHAR(50) NOT NULL DEFAULT
`'private'` (CHECK `private|shared|public`) · `owner_id` UUID FK→`admins` SET NULL · `created_by`
UUID FK→`admins` SET NULL · `created_at`, `updated_at` TIMESTAMPTZ NOT NULL DEFAULT `now()`.
Indeks: `idx_memories_memory_date`, `idx_memories_created_at`, `idx_memories_owner`.

### `media`
`id` UUID PK · `memory_id` UUID FK→`memories` **ON DELETE RESTRICT** · `title` VARCHAR(255) ·
`description` TEXT · `media_type` VARCHAR(50) NOT NULL (CHECK `photo|video`) · `taken_date` DATE
(**tanggal pengambilan**) · `storage_key` VARCHAR(512) NOT NULL · `storage_provider` VARCHAR(50)
NOT NULL DEFAULT `'r2'` (CHECK `r2|s3|gcs`) · `file_size` BIGINT · `mime_type` VARCHAR(100) ·
`width`, `height` INT · `duration_seconds` INT · `privacy` VARCHAR(50) NOT NULL DEFAULT `'private'`
(CHECK) · `owner_id`, `uploaded_by` UUID FK→`admins` SET NULL · `uploaded_at`, `updated_at`
TIMESTAMPTZ NOT NULL DEFAULT `now()`. Indeks: `idx_media_memory`, `idx_media_uploaded_at`,
`idx_media_taken_date`.

### `birthday_editions`
`id` UUID PK · `year` INT NOT NULL UNIQUE · `title` VARCHAR(255) NOT NULL · `subtitle` VARCHAR(255)
· `narrative` TEXT · `cover_media_id` UUID FK→`media` **ON DELETE RESTRICT** · `status` VARCHAR(50)
NOT NULL DEFAULT `'draft'` (CHECK `draft|scheduled|published|archived`) · `scheduled_at`,
`published_at` TIMESTAMPTZ · `privacy` VARCHAR(50) NOT NULL DEFAULT `'private'` (CHECK) ·
`created_by` UUID FK→`admins` SET NULL · `created_at`, `updated_at`. Constraint tambahan:
`chk_edition_sched` (status `scheduled` ⇒ `scheduled_at` NOT NULL), `chk_edition_pub` (status
`published` ⇒ `published_at` NOT NULL). Indeks: `idx_birthday_year`, `idx_birthday_status`.

### `content`
`id` UUID PK · `type` VARCHAR(50) NOT NULL (CHECK `narrative|letter|caption|page`) · `title`
VARCHAR(255) NOT NULL · `slug` VARCHAR(255) UNIQUE · `body` TEXT · `status` VARCHAR(50) NOT NULL
DEFAULT `'draft'` (CHECK `draft|review|scheduled|published|archived`) · `privacy` VARCHAR(50)
NOT NULL DEFAULT `'private'` (CHECK) · `scheduled_at`, `published_at` TIMESTAMPTZ · `created_by`
UUID FK→`admins` SET NULL · `created_at`, `updated_at`. Constraint `chk_content_sched`,
`chk_content_pub`. Indeks: `idx_content_status`, `idx_content_created_at`.

### `audit_logs`
`id` UUID PK · `actor_id` UUID FK→`admins` SET NULL · `actor_email` VARCHAR(255) · `actor_label`
VARCHAR(255) · `action` VARCHAR(100) NOT NULL (CHECK `chk_audit_action`:
`create|read|update|delete|publish|unpublish`)
· `entity_type` VARCHAR(100) NOT NULL (CHECK `chk_audit_entity`, **hanya**
`memory|media|birthday_edition|content`) ·
`entity_id` VARCHAR(255) · `ip_address` VARCHAR(100) · `user_agent` TEXT · `diff_json` JSONB ·
`created_at` TIMESTAMPTZ NOT NULL DEFAULT `now()`.

**Proteksi append-only** (`init.sql`): `trg_audit_logs_no_update` dan `trg_audit_logs_no_delete`
memanggil `audit_logs_no_mod()` yang melempar exception. Catatan: trigger **tidak** melindungi dari
superuser/database owner yang dapat menonaktifkan trigger.

**Penulis aktif**: `src/lib/memories/audit.ts` (`writeAuditLog`) melakukan
`INSERT INTO audit_logs (actor_id, actor_email, actor_label, action, entity_type, entity_id, ip_address, user_agent, diff_json)`
dengan `entity_type='memory'` dan `action IN ('create','update','delete')` untuk Memories — semua
kolom/nilai tersebut **cocok** dengan skema (tidak perlu perubahan). Penulisan bersifat
best-effort (kegagalan audit tidak menggagalkan operasi induk, dicatat ke log server).

**Koreksi dokumentasi (4G.17)**: `schema.sql` **tidak** mendefinisikan indeks apa pun pada
`audit_logs`. Dokumentasi lama menyebut indeks `actor_id`, `entity_type+entity_id`, `created_at` —
itu **tidak ada** di skema. Tidak diubah di SQL; hanya dikoreksi di dokumen ini.

### Keputusan terbuka — domain `audit_logs` (Tahap 4G.29)

**Nilai yang DIDUKUNG saat ini** (persis seperti di `db/schema.sql`, tidak diubah di tahap ini):

| Constraint | Nilai yang ada | Sumber |
|---|---|---|
| `chk_audit_entity` | `memory`, `media`, `birthday_edition`, `content` | `schema.sql` |
| `chk_audit_action` | `create`, `read`, `update`, `delete`, `publish`, `unpublish` | `schema.sql` |

**Penulis audit yang ADA saat ini (satu-satunya):** `src/lib/memories/audit.ts` (`writeAuditLog`),
dipanggil dari `src/app/api/memories/route.ts` (create) dan `src/app/api/memories/[id]/route.ts`
(update, delete). Ia selalu menulis `entity_type='memory'` dan `action IN ('create','update','delete')`
— cocok dengan CHECK. **Tidak ada** penulis yang memakai `media`, `birthday_edition`, atau `content`,
meskipun CHECK mengizinkannya.

**Peristiwa keamanan TIDAK diaudit saat ini.** Tidak ada kode di `src/app/api/auth/login/route.ts`,
`src/app/api/auth/logout/route.ts`, `src/lib/auth/session.ts`, atau `src/lib/auth/admin-security.ts`
yang menulis `audit_logs`. Jadi `login`/`logout`/`revoke` belum tercatat — **bukan hanya** karena
CHECK, tetapi karena **penulisnya memang belum ada**. Jangan mengklaim peristiwa keamanan "sudah
diaudit".

**Nilai yang DIUSULKAN — BELUM diterapkan (butuh `[PERLU IZIN]`):**

| Perubahan | Nilai baru | Kode yang (kelak) memicunya | Status |
|---|---|---|---|
| `chk_audit_entity` + | `birthday_letter` | draft 4G.26 `birthday_letters` | belum ada penulis |
| `chk_audit_entity` + | `private_archive` | draft 4G.27 `private_archives` | belum ada penulis |
| `chk_audit_entity` + | `admin`, `session` | tindakan keamanan akun/sesi | belum ada penulis |
| `chk_audit_action` + | `login`, `logout`, `revoke` | `login/route.ts`, `logout/route.ts`, `admin-security.ts` | belum menulis audit |

**Tidak diperlebar di tahap ini.** Memperlebar CHECK mengubah semantik constraint yang ada →
keputusan skema/produk; menunggu persetujuan eksplisit. Selama belum ada penulis, memperlebarnya
tidak mengubah perilaku apa pun, tetapi juga tidak boleh diklaim sudah memberi audit keamanan.

---

## 4b. Penanganan tipe DATE

- Kolom bertipe `DATE`: `memories.memory_date` (tanggal kejadian), `media.taken_date` (tanggal
  pengambilan) — lihat `db/schema.sql`.
- Kontrak aplikasi: driver mengembalikan `DATE` sebagai string `'YYYY-MM-DD'`, **bukan** objek
  `Date` JS. `src/lib/db.ts:44` menyetel parser tipe `pg` OID 1082 → string (`(value) => value`),
  agar konsisten dengan `MemoryRow.memory_date: string` (`src/lib/memories/repository.ts:25-26`).
- Validasi input sudah membatasi format `YYYY-MM-DD` dan kalender nyata
  (`src/lib/memories/schema.ts` `isIsoDate`), sehingga string yang dikirim ke kolom `DATE` valid.
- **[BELUM DIUJI]** Komentar `db.ts:40-43` mengklaim kesetaraan dengan driver Neon; parser tipe
  Neon **tidak** disentuh. Kesetaraan perilaku `DATE` antara driver `pg` dan
  `@neondatabase/serverless` **belum** diverifikasi terhadap DB nyata.

---

## 5. Hubungan antartabel

```
admins 1───n memories        (owner_id, created_by)   ON DELETE SET NULL
admins 1───n media           (owner_id, uploaded_by)  ON DELETE SET NULL
admins 1───n birthday_editions (created_by)           ON DELETE SET NULL
admins 1───n content         (created_by)             ON DELETE SET NULL
admins 1───n audit_logs      (actor_id)               ON DELETE SET NULL
admins 1───n sessions        (admin_id)               ON DELETE CASCADE   [DRAFT]
memories 1─n media           (memory_id)              ON DELETE RESTRICT
media    1─n birthday_editions (cover_media_id)       ON DELETE RESTRICT
```

- `audit_logs` menyimpan snapshot `actor_email`/`actor_label` agar jejak tetap ada saat akun
  dinonaktifkan (FK `SET NULL`).
- `sessions` **satu-satunya** relasi dengan `ON DELETE CASCADE`; tetapi kebijakan proyek adalah
  **tidak menghapus admin** (hanya `is_active=false`), sehingga cascade **jarang/tidak** dipakai —
  inilah sebabnya `is_active` harus tetap diperiksa di setiap validasi sesi (§6).
- Media/birthday memakai `RESTRICT` untuk mencegah referensi orphan. (Belum ada aplikasi yang
  memakai tabel `media`/`birthday_editions`/`content`; media aplikasi saat ini adalah penyimpanan
  filesystem `storage/media/index.json`.)

---

## 6. Perilaku sesi: expiry, sliding, absolut, revokasi

Dari `src/lib/auth/session.ts` dan `src/lib/auth/admin-security.ts`:

| Aspek | Nilai | Bukti |
|---|---|---|
| Nama cookie | `vanka_session` | `session.ts:6` |
| Sliding window | 7 hari | `session.ts:7` |
| Batas absolut | 30 hari dari `created_at` | `session.ts:8` |
| Saat dibuat | `expires_at = now() + 7 days` | `session.ts:46-56` |
| Validasi + renewal | **satu statement** (CTE `WITH renewed AS`): `revoked_at IS NULL` **AND** `expires_at > now()` **AND** `created_at + 30 days > now()` **AND** admin aktif (`EXISTS (... is_active = true)`), lalu `expires_at = LEAST(now() + 7 days, created_at + 30 days)` | `session.ts:69-97` |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `path=/`, `Secure` hanya bila `NODE_ENV=production`, `maxAge` 30 hari | `session.ts` (`setSessionCookie`) |
| Logout | cabut **satu** sesi berdasarkan `token_hash`; error DB diteruskan | `session.ts:104-111` |
| Cabut semua sesi admin | `revokeAllSessions(adminId)` — `UPDATE ... WHERE admin_id=$1 AND revoked_at IS NULL` | `session.ts:118-124` |
| Cabut semua kecuali sesi ini | `revokeAllSessionsExcept(adminId, keepSessionId)` — tambah `id <> $2` | `session.ts:132-141` |
| Nonaktifkan admin + revokasi | `deactivateAdminAndRevokeSessions(adminId)` — satu CTE atomik (`UPDATE admins SET is_active=false` **dan** `UPDATE sessions SET revoked_at=now()`) | `admin-security.ts` |
| Set hash password + revokasi | `setAdminPasswordHashAndRevokeSessions(adminId, passwordHash)` — satu CTE atomik | `admin-security.ts` |

**Status implementasi (Tahap 4G.18) — diuji unit (mock), BELUM diuji terhadap DB nyata:**
- Validasi+renewal kini **atomik** (satu statement, satu snapshot) — menghapus jendela TOCTOU
  sebelumnya; sesi yang dicabut tidak dapat diperpanjang kembali.
- `revokeAllSessionsExcept`, `deactivateAdminAndRevokeSessions`, dan
  `setAdminPasswordHashAndRevokeSessions` **baru ditambahkan** dan diuji dengan fake pool.
- Ketiga helper akun/sesi **belum dipakai oleh route mana pun** — belum ada endpoint manajemen
  admin, jadi tidak ada jalur HTTP yang memicunya (tetap blocker untuk alur end-to-end).
- **Kegagalan DB selalu reject**; tidak ada operasi yang dilaporkan berhasil bila UPDATE gagal.

**Konsekuensi perilaku:**
- `is_active=false` tetap diperiksa di setiap validasi sesi (dalam CTE dan pada JOIN), sehingga
  request berikutnya langsung ditolak 401. Helper `deactivateAdminAndRevokeSessions` menjadikan
  `revoked_at` durabel dalam transaksi yang sama.
- Mengganti `password_hash` **via helper baru** otomatis mencabut sesi (reset); ganti mandiri
  memakai `revokeAllSessionsExcept` untuk mempertahankan sesi saat ini. Tanpa endpoint, tidak ada
  yang memanggil helper ini dari aplikasi.
- Logout hanya mencabut sesi saat ini; cookie dibersihkan **hanya** setelah revokasi sukses
  (`logout/route.ts:11-13`).

---

## 7. Kolom/constraint yang belum ada pada skema dasar

1. `admins.password_hash` — hanya di draft migration.
2. Tabel `sessions` — hanya di draft migration.
3. Tabel `login_attempts` — hanya di draft migration.
4. Indeks pada `audit_logs` — **tidak ada** (dokumentasi lama salah; lihat §4).
5. Tidak ada tabel versi/riwayat migration, dan tidak ada skrip rollback.
6. Tidak ada kolom/relasi untuk surat & arsip privat (saat ini hanya `localStorage`
   `vanka.letters.v2` dan `vanka.private-archive.draft.v1`); tabel `content` tersedia tetapi belum
   dipakai kode. Tabel `media`/`birthday_editions` juga belum dipakai kode (media aplikasi masih
   filesystem `storage/media/index.json`).
7. Indeks `idx_birthday_year` pada `birthday_editions(year)` **redundan** dengan constraint
   `UNIQUE (year)` (yang sudah membuat indeks sendiri). Tidak diubah di SQL (perubahan skema di
   luar cakupan tahap ini); dicatat sebagai temuan.

---

## 8. Risiko `IF NOT EXISTS` (schema drift)

Draft migration memakai `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS` (dan `COMMENT ON`, yang idempoten). Menurut catatan draft sendiri
(`draft:14-17`):

- `IF NOT EXISTS` **hanya** mencocokkan **nama** objek, bukan definisi.
- Bila objek dengan nama sama sudah ada tetapi berbeda definisi, perintah **dilewati senyap**
  tanpa peringatan dan tanpa error.
- Karena itu, "migration selesai tanpa error" **bukan** bukti struktur cocok.

Contoh drift yang berbahaya:
- `admins.password_hash` sudah ada tetapi bertipe bukan `TEXT`.
- `sessions` ada tetapi tanpa `created_at` → query `session.ts:74-90` gagal saat runtime.
- `token_hash` bukan `UNIQUE` → token bisa duplikat (cacat keamanan).
- FK tanpa `ON DELETE CASCADE`, atau indeks partial hilang.
- Migration dijalankan dua kali setelah objek diubah → definisi lama tetap dipakai.

Karena tidak ada tabel versi/riwayat migration, satu-satunya cara mendeteksi drift adalah
memeriksa `information_schema`/`pg_indexes` setelah penerapan (lihat `db/MIGRATION_CHECKLIST.md`).
DDL PostgreSQL bersifat transaksional, sehingga kegagalan di tengah akan rollback — **tetapi**
transaksi tidak memperbaiki objek yang sudah ada dengan definisi berbeda.

---

## 9. Prinsip desain (tetap berlaku)

1. **Privacy First**: kolom `privacy` terpisah dari `status` publikasi.
2. **Tanggal berlapis**: `memory_date`/`taken_date` (kejadian) vs `uploaded_at`/`created_at`
   (metadata sistem) vs `published_at` (publikasi).
3. **Publikasi terjadwal**: CHECK memaksa `scheduled_at`/`published_at` terisi sesuai status.
4. **Audit & akuntabilitas**: snapshot `actor_email`/`actor_label`; akun dinonaktifkan
   (`is_active=false`), tidak dihapus. Catatan: `chk_audit_entity` saat ini **tidak** mengizinkan
   `entity_type` `admin`/`session`, sehingga tindakan keamanan akun/sesi belum dapat diaudit tanpa
   perubahan skema (lihat laporan 4G.17 Bagian C).
5. **Storage agnostik**: `storage_provider` (`r2|s3|gcs`) + `storage_key` (path, bukan URL).
6. **Integritas**: `ON DELETE RESTRICT` pada relasi media/cover untuk mencegah referensi orphan.

## 10. Belum diverifikasi terhadap database nyata

- Semua pernyataan di dokumen ini berasal dari **berkas**, bukan dari database yang berjalan.
- Belum ada database lokal/Neon, belum ada `.env*`, belum ada migration yang dijalankan.
- Belum ada akun admin/owner yang dibuat; login end-to-end belum diuji.
- Ketersediaan extension `uuid-ossp` di Neon dan kompatibilitas runtime Neon/Workers belum diuji
  (lihat `db/NEON_IMPLEMENTATION_PLAN.md`).
