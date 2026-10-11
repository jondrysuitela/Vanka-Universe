# Vanka Universe — Rencana Penyimpanan Media Privat & Kesiapan Migration ke R2

> **Status: AUDIT + RENCANA. Tidak ada implementasi, tidak ada bucket/ resource
> Cloudflare, tidak ada perubahan kode.** Dokumen ini dibuat pada Tahap 4G.21.
> Tidak ada migration yang dijalankan, tidak ada DB/Neon yang dikonfigurasi.
>
> Label yang dipakai di seluruh dokumen:
> - **[FAKTA]** — terverifikasi dari berkas repo saat ini.
> - **[REKOMENDASI]** — rancangan yang diusulkan, belum diterapkan.
> - **[BELUM DIUJI]** — tidak dapat diverifikasi tanpa DB/R2/Workers/runtime.
> - **[PERLU IZIN]** — membutuhkan persetujuan eksplisit pemilik proyek.

---

## 1. Status storage saat ini

**[FAKTA] Bentuk penyimpanan**
- Media disimpan di **filesystem lokal**, di luar `public/`:
  `MEDIA_DIR = <cwd>/storage/media` dan `INDEX_FILE = <cwd>/storage/media/index.json`
  (`src/lib/media/store.ts:23-24`).
- Metadata seluruh media ada dalam **satu file JSON** (`index.json`), bukan database.
  Tabel `media` di `db/schema.sql` **belum** dipakai kode.
- Modul menandai dirinya server-only: `import "server-only"` (`store.ts:1`).

**[FAKTA] Isi disk saat ini**
- Direktori `storage/` **belum ada** (belum pernah ada file media nyata) → sistem berjalan
  pada storage kosong.
- `public/` hanya berisi aset bawaan Next (`file.svg`, `globe.svg`, `next.svg`,
  `vercel.svg`, `window.svg`). **Tidak ada** file media pengguna di `public/`.
- `.gitignore` **tidak** memuat `storage/` (hanya `/.next/`, `/out/`, `.env*`, dll) →
  berisiko file media ikut ter-commit bila repo dijadikan git (lihat §2 R8).

**[FAKTA] Validasi saat upload** (`saveMediaUpload`, `store.ts:136-180`)
- Tipe file ditentukan oleh **magic bytes**, bukan nama/MIME klien (`sniffMime`,
  `store.ts:57-88`): JPEG, PNG, GIF, WebP, MP4. Selain itu → `415 UNSUPPORTED_TYPE`.
- Batas ukuran per jenis: gambar 10 MB, video 50 MB (`store.ts:45-46`, `:147-154`) →
  `413 FILE_TOO_LARGE`.
- Batas envelope request 51 MiB (`MAX_REQUEST_BYTES`): `Content-Length` awal + **batas stream
  nyata** via `limitRequestBody` (4G.23), berlaku tanpa/dengan `Content-Length` menyesatkan.
- `id` = `randomUUID()` server-side (`store.ts:156`); nama simpan = `${id}.${ext}` dengan
  `ext` dari peta MIME server (`store.ts:48-54`, `:157`).
- Nama tampilan = `path.basename(file.name).slice(0,255)` (`store.ts:161`) — hanya metadata,
  **tidak** dipakai membentuk path.
- Validasi kedua di route: `ID` path harus UUID (`src/app/api/media/[id]/route.ts:11`).

**[FAKTA] Perilaku endpoint** (`src/app/api/media/route.ts`, `src/app/api/media/[id]/route.ts`)
- `GET /api/media` → daftar metadata. `POST /api/media` → simpan 1 file (multipart).
- `GET /api/media/[id]` → stream file privat, dukung HTTP Range (`206`, `416`), set
  `Cache-Control: private, max-age=0, must-revalidate`.
- `PATCH /api/media/[id]` → ubah `title`/`description`/`takenAt` saja (strict schema).
- `DELETE /api/media/[id]` → hanya bila reference check positif `clear` (fail-closed).
- Semua endpoint butuh sesi valid + role `owner|admin` (4G.20), CSRF pada mutasi.

**[FAKTA] Penanganan error/edge**
- Index hilang → `readIndex` mengembalikan `[]` (storage kosong yang sah). Index ADA tetapi
  rusak/struktur tidak valid → `MediaIndexError` dilempar, **bukan** daftar kosong
  (diperbarui Tahap 4G.22; sebelumnya error ditelan menjadi `[]`).
- File hilang saat baca → `readMediaFile` menangkap error → `null` → 404
  (`store.ts:191-196`).
- Rekaman dengan MIME tak dikenal / id aneh → `storedFilePath` mengembalikan `null`
  (guard `path.basename`, `store.ts:118-125`) → 404.
- Urutan delete: hapus entri index dulu, lalu unlink; bila unlink gagal selain `ENOENT`,
  index dipulihkan dan error dilempar kembali (`store.ts:245-267`).

---

## 2. Temuan keamanan (dengan tingkat risiko)

| # | Temuan | Tingkat | Bukti |
|---|---|---|---|
| R1 | **Media privat sudah benar tidak disajikan statis.** File di luar `public/`; hanya diakses lewat route ber-sesi + policy role. Tidak ada URL publik permanen. | **Baik (fakta)** | `store.ts:10-21`; `media/[id]/route.ts:23-25` |
| R2 | **Path traversal tidak mungkin dari input klien**: path dibentuk dari `id` (UUID server) + `ext` (peta server), plus guard `path.basename`. Nama file klien hanya metadata. | **Rendah (fakta)** | `store.ts:118-125`, `:156-161` |
| R3 | **Buffering penuh (parsial diperbaiki 4G.23)**: body kini dibatasi **saat dibaca** oleh `limitRequestBody` (`src/lib/media/request-body.ts`) — cap 51 MiB pada stream request, independen dari `Content-Length`; melebihi cap → stream di-error (`413`) dan sumber dibatalkan, jadi tidak pernah seluruh body besar terbuffer. SISA: body yang **diterima** tetap dimaterialkan di memori oleh `formData()`/`file.arrayBuffer()` (`store.ts:137`) — dibatasi cap, bukan di-stream ke disk. | **Sedang → Rendah (sisa: buffering hingga cap)** | `request-body.ts`, `route.ts`, `store.ts:137` |
| R4 | ~~Race read-modify-write pada `index.json`~~ **DIPERBAIKI (4G.22)**: mutasi index diserialisasi dengan lock promise proses-lokal **dan** penulisan atomic (tulis `<index>.json.<uuid>.tmp` lalu `rename`). Sisa: lock hanya berlaku dalam **satu proses Node** — bukan lintas proses (cluster/pm2/worker terpisah). | **Rendah (sisa: multi-process)** | `store.ts` `withIndexLock`/`writeIndex` |
| R5 | ~~Index rusak = semua media "hilang" senyap~~ **DIPERBAIKI (4G.22)**: `readIndex` membedakan file hilang (`ENOENT` → `[]`) dari file rusak/tak dapat dibaca → `MediaIndexError` (`INDEX_CORRUPT`/`INDEX_READ_FAILED`); index rusak tidak pernah ditimpa `[]` dan tidak ada recovery otomatis. | **Rendah** | `store.ts` `readIndex`/`MediaIndexError` |
| R6 | **Orphan file**: `saveMediaUpload` menulis file sebelum update index (`:159` lalu `:176-178`); bila penulisan index gagal, file tetap ada tanpa metadata. Delete menulis index sebelum unlink, jadi crash di tengah meninggalkan file tak terindeks. | **Rendah** | `store.ts:159`, `:176-178`, `:253-265` |
| R7 | **Sniff MP4 lemah**: hanya memeriksa `ftyp` pada offset 4 (`:84`), sehingga berkas ber-"ftyp" non-video bisa lolos sebagai `video/mp4`. Tidak dieksekusi, jadi dampak terbatas. | **Rendah** | `store.ts:84-86` |
| R8 | ~~`storage/` tidak di-`.gitignore`~~ **DIPERBAIKI (4G.22)**: `.gitignore` memuat `/storage/`. Catatan: `.gitignore` hanya mencegah file **belum-terlacak** ikut ditambahkan; file yang sudah tracked tetap butuh audit terpisah. Tidak ada index Git yang diubah. | **Rendah** | `.gitignore` |
| R9 | **Ketergantungan filesystem + `process.cwd()`**: tidak kompatibel dengan runtime read-only/serverless (Workers) — lihat §7. | **Sedang (arsitektur)** | `store.ts:3`, `:23` |
| R10 | **Tidak ada validasi isi index**: `normalizeRecord` menyamakan tipe metadata, tetapi tidak memvalidasi `id`/`mime`/`size`. Index yang dimodifikasi manual bisa berisi nilai aneh (namun path tetap dijaga R2). | **Rendah** | `store.ts:108-115` |

**Catatan penting [FAKTA]:** reference-check DELETE bersifat **fail-closed** — registry probe
kosong → `unverifiable` → `409` (tidak pernah menghapus). Lihat `src/lib/media/references.ts:49-61`.
Artinya **saat ini tidak ada media yang benar-benar bisa dihapus** selama belum ada probe
terdaftar; ini disengaja.

**Tidak terbukti / belum diuji [BELUM DIUJI]:** R4 kini punya tes konkurensi dalam-proses
(4G.22) tetapi belum diuji lintas proses; R3 punya batas ukuran stream nyata (4G.23) tetapi
body yang diterima **masih** dimaterialkan di memori (dibatasi cap, bukan stream ke disk); tidak
ada file media nyata untuk menguji jalur sukses/edge di production.

---

## 3. Arsitektur R2 target [REKOMENDASI]

Prinsip: **otorisasi tetap di server; R2 hanya menyimpan objek privat.**

1. **Bucket R2 privat** (`vanka-media` atau setara). Tanpa custom domain publik, tanpa
   `r2.dev` publik, tanpa bucket policy yang mengizinkan anonim. Tidak ada objek `public-read`.
2. **Object key tidak dapat ditebak/ditebak-ulang**: pakai pola `media/<uuid>.<ext>` dengan
   `uuid` server-side (bukan nama klien). Sama seperti `id` saat ini.
3. **Server wajib memvalidasi sesi + role (`owner|admin`) sebelum akses**, persis seperti
   sekarang (tidak berubah). Akses R2 **hanya** lewat server (S3 API / binding), tidak
   pernah dari klien langsung dengan kredensial.
4. **Dua mode penyajian (pilih salah satu; belum diputuskan):**
   - **(a) Proxy streaming terautentikasi** (paling kompatibel + kontrol penuh): server
     mengambil objek dari R2 lalu mengalirkannya sebagai response. Cookie sesi & policy
     diperiksa pada setiap request; **tidak ada URL bertanda tangan**. Cocok dengan
     dukungan Range seperti `GET /api/media/[id]` saat ini.
   - **(b) URL bertanda tangan berumur pendek (presigned)**: server mengembalikan URL
     sementara (mis. ≤300 detik) bila klien dipercaya membaca. **Batas masa berlaku =
     batas otorisasi**: sesudah kedaluwarsa, siapa pun yang memegang URL **tidak** lagi
     bisa mengakses; tetapi **selama** masa berlaku, link tersebut dapat dibagikan dan
     diakses **tanpa** cookie sesi. Karena itu presigned URL **bukan** pengganti otorisasi
     pada saat permintaan; ia hanya memindahkan jendela akses. Untuk media keluarga privat,
     mode (a) lebih aman; mode (b) hanya bila benar-benar dibutuhkan (mis. streaming besar
     dari CDN) dan dengan TTL pendek + parameter respons terbatas.
   - **[REKOMENDASI]** mulai dengan **(a)**, tambah (b) hanya bila terbukti perlu.
5. **Validasi upload identik di server** (magic bytes, batas ukuran, MIME map) — pindahkan
   logika `sniffMime`/batas ukuran, jangan percaya klien. Tambah **penolakan awal** berdasar
   `Content-Length` bila tersedia, dan idealnya stream ke R2 tanpa buffer penuh (menutup R3).
6. **DELETE tetap memeriksa referensi lebih dulu** (`checkMediaReferences` → hanya `clear`
   yang boleh menghapus). Hapus objek R2 **setelah** verifikasi; maskipun begitu, jika
   unlink/index gagal, jangan laporkan sukses (fail-closed).
7. **Konsistensi metadata vs object storage**: metadata pindah ke tabel `media` (DB) atau
   tetap index JSON pada tahap awal. Apapun pilihannya: satu sumber kebenaran (source of
   truth) dan operasi idempoten. Jangan menganggap "objek ada di R2" sama dengan "record
   ada di DB".
8. **Rahasia**: kredensial R2 (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_ACCOUNT_ID`, nama bucket) **hanya** dari env server; **tidak** masuk metadata publik,
   respons API, atau log. URL bertanda tangan yang tercatat di log = kebocoran → jangan log.

---

## 4. Kontrak API yang harus dipertahankan [FAKTA → WAJIB DIPERTAHANKAN]

Kontrak yang sudah ada dan **tidak boleh** berubah selama migrasi:

| Endpoint | Kontrak saat ini |
|---|---|
| `GET /api/media` | `200 { data: MediaRecord[] }`; butuh sesi + `owner|admin` |
| `POST /api/media` | multipart `file`; `201 { data: MediaRecord }`; `415` tipe, `413` ukuran, `422` tanpa file; CSRF wajib |
| `GET /api/media/[id]` | `200` stream; `206`/`416` untuk Range; `404` tak ada; `Cache-Control: private` |
| `PATCH /api/media/[id]` | `200 { data: MediaRecord }`; hanya `title`/`description`/`takenAt`; strict (kunci lain `422`); CSRF |
| `DELETE /api/media/[id]` | `200 { data: { id } }`; `409 CONFLICT` / `409 REFERENCE_UNVERIFIED`; CSRF |
| Umum | `401` sesi tak valid; `403` `FORBIDDEN` untuk role tak diizinkan; error generik `500` tanpa detail internal |

**Bentuk `MediaRecord`** (harus stabil): `id, name, mime, kind, size, ownerId, ownerLabel,
createdAt, title, description, takenAt` (`store.ts:28-43`).

**Konsumen klien yang harus tetap bekerja** [FAKTA]:
- `src/app/admin/(protected)/media/page.tsx` — `GET /api/media`, `POST /api/media`
  (`x-vanka-request: 1`, FormData), `<img src="/api/media/{id}">`.
- `src/app/admin/(protected)/content/page.tsx` — `GET /api/media`, `PATCH`, `DELETE`.
- `src/app/admin/(protected)/archive/page.tsx` — `GET /api/media`.
- `<img>` (bukan `next/image`) dipakai sengaja karena endpoint privat butuh cookie sesi.

---

## 5. Strategi migrasi & pemulihan kegagalan [REKOMENDASI]

**Migrasi (tanpa kehilangan file)**
1. Bekukan penulisan singkat (maintenance) atau dukung *dual-write* sementara.
2. Untuk setiap record di `index.json`: unggah objek ke R2 dengan key `media/<id>.<ext>`
   (ext dari MIME map; bukan dari nama). Verifikasi ukuran/ETag objek == ukuran file lokal.
3. Tandai record sebagai "migrated" **hanya** setelah verifikasi objek sukses.
4. Ganti backend baca baca-bertingkat: R2 dulu, fallback filesystem selama migrasi.
5. Baru setelah 100% record terverifikasi, hentikan fallback. **Jangan hapus file lokal**
   sampai ada backup independen + persetujuan (lihat §8).

**Pemulihan kegagalan**
- Upload: bila unggah objek R2 gagal → **jangan** tulis record; balas error. Bila tulis
  record gagal setelah objek sukses → tandai objek sebagai *orphan* dan hapus best-effort
  atau simpan di daftar pembersihan (jangan diamkan).
- Delete: verifikasi referensi → hapus objek R2 → hapus record. Bila hapus objek gagal,
  **pertahankan record** dan balas error (jangan pernah melaporkan sukses).
- Baca: objek hilang di R2 tapi record ada → `404` + catat log (konsisten dengan perilaku
  filesystem saat ini). Record ada tapi index rusak → jangan fallback ke `[]` senyap;
  naikkan sinyal error.

---

## 6. Rencana tes [REKOMENDASI — belum ada]

Tes yang **sudah** ada (jangan diregresi) [FAKTA]: `src/lib/media/__tests__/store.test.ts` (7),
`metadata.test.ts` (13), `references.test.ts` (6), `src/app/api/media/__tests__/media.routes.test.ts` (26).
Setelah 4G.22: `store.test.ts` **14**, `media.routes.test.ts` **28**, total suite **207**.
Setelah 4G.23: `request-body.test.ts` **8** (baru), `media.routes.test.ts` **32**, total suite **219**.

Tes tambahan yang wajib ditambahkan sebelum/ketika migrasi diimplementasikan:
- **Otorisasi**: tanpa sesi `401`; `editor` `403`; `owner`/`admin` boleh, untuk **semua** metode.
- **URL kedaluwarsa** (bila memakai presigned): URL kadaluwarsa → akses gagal; TTL benar.
- **Upload**: magic bytes vs MIME klien; `415` tipe tak didukung; `413` ukuran; penolakan
  awal berdasar `Content-Length` **dan** batas stream nyata tanpa/`Content-Length` menyesatkan
  (sudah ada sejak 4G.23).
- **Baca**: byte identik dengan sumber; Range `206`/`416`; objek hilang → `404`.
- **Delete**: `clear` menghapus; `referenced`/`unverifiable` menolak `409`; gagal R2 →
  record tetap ada + error.
- **Kegagalan storage**: R2 timeout/error → tidak ada klaim sukses; tidak ada data setengah jadi.
- **Konsistensi**: record ↔ objek; objek orphan terdeteksi.
- **Tidak ada kebocoran**: kredensial/URL rahasia tidak muncul di respons atau log.

---

## 7. Dependensi & kompatibilitas Workers/OpenNext

**[FAKTA] Repo saat ini**
- `package.json` **tidak** memuat `@opennextjs/cloudflare`, `wrangler`, AWS SDK, atau SDK R2.
- `next.config.ts` hanya: `cacheComponents: true`, `partialPrefetching: true`, aturan
  Turbopack CSS Tailwind. **Tidak** ada `output: "standalone"`.
- `store.ts` memakai `node:fs/promises`, `node:path`, dan `process.cwd()` — semua **tidak
  tersedia** di Cloudflare Workers kecuali lewat polyfill/compat yang belum ada.
- `src/lib/db.ts` mengimpor statis `pg` **dan** `@neondatabase/serverless`.

**[BELUM DIUJI] Perubahan yang kemungkinan diperlukan untuk Workers**
- Mengganti penyimpanan filesystem dengan R2 binding (Workers) atau S3 API (Node).
- Memastikan `server-only`, `node:crypto`, dan `bcryptjs` berjalan di runtime target.
- Bila memakai OpenNext: menambahkan adapter + `wrangler` + konfigurasi R2 binding;
  **belum** dipasang dan **belum** diuji.
- Perilaku `cacheComponents` + route ber-sesi di edge **belum** diuji.

**[REKOMENDASI]** Pertahankan abstraksi tipis di atas `store.ts` (interface
`list/save/read/find/update/delete`) agar implementasi filesystem dan R2 dapat ditukar tanpa
mengubah route maupun kontrak klien.

---

## 8. Prasyarat & persetujuan yang diperlukan [PERLU IZIN]

- Membuat bucket R2 / resource Cloudflare (nama, region/jurisdiction, retensi).
- Menyentuh `.env`/secret: `R2_*`, `DATABASE_URL`, `DB_DRIVER`.
- Menjalankan SQL/migration bila metadata media pindah ke tabel `media`.
- Memindahkan/menyentuh file media pengguna yang ada (saat ini **tidak ada** file).
- Menambah dependency (`@opennextjs/cloudflare`, `wrangler`, SDK R2/S3) — butuh persetujuan.
- Memilih mode penyajian: (a) proxy terautentikasi atau (b) presigned URL berumur pendek.

---

## 9. Urutan tahap implementasi berikutnya [REKOMENDASI]

1. **Setujui mode penyajian** (§3.4) dan target key scheme (§3.2).
2. **Abstraksi storage**: ekstrak interface di atas `store.ts` tanpa mengubah kontrak API;
   tambahkan tes interface (dapat dijalankan dengan backend filesystem yang ada).
3. **Adapter R2**: implementasi interface memakai R2/S3; validasi upload di server;
   streaming/proxy terautentikasi; jangan log kredensial/URL.
4. **Metadata**: putuskan index JSON vs tabel `media`; bila DB, buat migration
   non-destruktif + verifikasi.
5. **Migrasi data**: hanya setelah ada izin; dengan verifikasi ukuran/ETag per objek dan
   fallback baca.
6. **Tes**: otorisasi, TTL kedaluwarsa (bila ada), upload, baca/Range, delete + referensi,
   kegagalan storage, konsistensi, no-leak.
7. **Decommission filesystem** hanya setelah backup + persetujuan; jangan hapus apa pun lebih
   dulu.

> **Catatan lintas dokumen:** penambahan route guard `/admin/*` (4G.19) dan kebijakan role
> media (4G.20) sudah tercatat di `db/NEON_IMPLEMENTATION_PLAN.md`. Dokumen ini fokus pada
> **storage**; rencana DB/Neon tetap di dokumen tersebut.

---

## 10. Klaim yang TIDAK boleh dibuat

- R2 **belum** dibuat dan **belum** tersedia; tidak ada bucket, tidak ada binding.
- Tidak ada migrasi yang dijalankan; tidak ada data dipindahkan.
- Tidak ada tes runtime/DB/Workers yang dijalankan untuk tahap ini.
- `tsc`/`next build` **tidak** dijalankan pada tahap ini (dan `next build` dilarang).
