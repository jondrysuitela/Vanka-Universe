// ============================================================================
// Arsip Ibu gallery — DB round-trip + negative E2E probe (Tahap 4G.39D).
//
// SAFE BY DEFAULT: refuses to write unless explicitly opted in. Never prints
// secrets (password, cookie, token). Never uploads fixtures. Talks HTTP only.
//
// USAGE (after the 4g39 migration is applied and you accept the risk):
//   VANKA_ALLOW_TEST_WRITES=1
//   VANKA_BASE_URL=http://localhost:3000
//   VANKA_ADMIN_EMAIL=you@example.com
//   VANKA_ADMIN_PASSWORD=********
//   VANKA_PHOTO_MEDIA_IDS=<uuid>,<uuid>
//   VANKA_INTRO_MEDIA_ID=<uuid>
//   node scripts/archive-gallery-e2e.mjs
//
// PREFER A NEON BRANCH: point the dev server at a branch DB so the singleton
// archive `tentang-ibumu` is never touched in production. The script restores
// the EXACT gallery it read first, so cleanup only touches its own writes
// (VANKA_RESTORE_BASELINE=0 disables that — not recommended).
// ============================================================================

import { randomUUID } from "node:crypto";

const BASE = (process.env.VANKA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const EMAIL = process.env.VANKA_ADMIN_EMAIL;
const PASSWORD = process.env.VANKA_ADMIN_PASSWORD;
const ALLOW = process.env.VANKA_ALLOW_TEST_WRITES === "1";
const RESTORE = process.env.VANKA_RESTORE_BASELINE !== "0";
const INTRO_ID = process.env.VANKA_INTRO_MEDIA_ID ?? null;
const PHOTO_IDS = (process.env.VANKA_PHOTO_MEDIA_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let cookie = null;
let failures = 0;

function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function die(msg, code = 2) {
  console.log(`ABORT: ${msg}`);
  process.exit(code);
}

function authHeaders(extra = {}) {
  return { origin: ORIGIN, accept: "application/json", cookie, ...extra };
}

async function apiGet() {
  const res = await fetch(`${BASE}/api/archive/gallery`, { headers: authHeaders() });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function apiPut(body, { csrf = true } = {}) {
  const headers = authHeaders({ "content-type": "application/json" });
  if (csrf) headers["x-vanka-request"] = "1";
  const res = await fetch(`${BASE}/api/archive/gallery`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-vanka-request": "1" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) die(`login failed (status=${res.status})`);
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const session = setCookies.find((c) => c && c.startsWith("vanka_session="));
  if (!session) die("login did not set a session cookie");
  cookie = session.split(";")[0];
}

function buildBody(introId, photos) {
  return {
    introMediaId: introId,
    photos: photos.map((p, i) => ({
      mediaId: p.mediaId,
      title: p.title ?? `Uji ${i + 1}`,
      description: p.description ?? `Deskripsi individual ${i + 1}`,
      memoryDate: p.memoryDate ?? null,
    })),
  };
}

async function main() {
  if (!ALLOW) {
    die(
      "test writes are disabled. This script writes the singleton archive.\n" +
        "       Re-run with VANKA_ALLOW_TEST_WRITES=1 ONLY after the 4g39 migration is\n" +
        "       applied and (preferably) the server points at a Neon branch.",
    );
  }
  if (!EMAIL || !PASSWORD) die("set VANKA_ADMIN_EMAIL and VANKA_ADMIN_PASSWORD");

  await login();
  console.log(`INFO  logged in as ${EMAIL} (cookie not printed)`);

  const baseline = await apiGet();
  if (baseline.status === 503) {
    die("GALLERY_NOT_MIGRATED — apply db/draft_migration_4g39_archive_gallery.sql first.", 3);
  }
  check("baseline GET is 200", baseline.status === 200, `status=${baseline.status}`);
  if (baseline.status !== 200) die("cannot read baseline gallery");
  const baseData = baseline.body?.data ?? { introMediaId: null, photos: [] };

  if (PHOTO_IDS.length < 2) {
    const listRes = await fetch(`${BASE}/api/media`, { headers: authHeaders() });
    const list = (await listRes.json().catch(() => ({ data: [] })))?.data ?? [];
    console.log("INFO  provide VANKA_PHOTO_MEDIA_IDS (>=2 images) and VANKA_INTRO_MEDIA_ID (video):");
    for (const m of list) console.log(`      ${m.kind}\t${m.id}\t${m.name}`);
    die("missing test media ids");
  }

  try {
    const first = buildBody(INTRO_ID, [
      { mediaId: PHOTO_IDS[0], title: "Kenangan Pertama", description: "Deskripsi A", memoryDate: "1999-01-02" },
      { mediaId: PHOTO_IDS[1], title: "Kenangan Kedua", description: "Deskripsi B", memoryDate: null },
    ]);
    const put1 = await apiPut(first);
    const d1 = put1.body?.data;
    check("PUT gallery -> 200", put1.status === 200, `status=${put1.status}`);
    check("PUT echoes intro", d1?.introMediaId === INTRO_ID);
    check(
      "PUT echoes order + individual metadata",
      d1?.photos?.[0]?.title === "Kenangan Pertama" && d1?.photos?.[1]?.title === "Kenangan Kedua",
    );
    check("PUT echoes memory_date", d1?.photos?.[0]?.memoryDate === "1999-01-02");

    const g1 = (await apiGet()).body?.data;
    check("GET round-trip intro", g1?.introMediaId === INTRO_ID);
    check(
      "GET round-trip order",
      g1?.photos?.[0]?.mediaId === PHOTO_IDS[0] && g1?.photos?.[1]?.mediaId === PHOTO_IDS[1],
    );
    check("GET round-trip description", g1?.photos?.[0]?.description === "Deskripsi A");

    await apiPut(
      buildBody(INTRO_ID, [
        { mediaId: PHOTO_IDS[1], title: "Kenangan Kedua", description: "Deskripsi B" },
        { mediaId: PHOTO_IDS[0], title: "Kenangan Pertama", description: "Deskripsi A" },
      ]),
    );
    check("reorder persists", (await apiGet()).body?.data?.photos?.[0]?.mediaId === PHOTO_IDS[1]);

    const dup = await apiPut(buildBody(INTRO_ID, [{ mediaId: PHOTO_IDS[0] }, { mediaId: PHOTO_IDS[0] }]));
    check("duplicate photo -> 422", dup.status === 422, `status=${dup.status}`);

    const unknown = await apiPut(buildBody(null, [{ mediaId: randomUUID() }]));
    check("unknown media id -> 422", unknown.status === 422, `status=${unknown.status}`);

    if (INTRO_ID) {
      const introAsPhoto = await apiPut(buildBody(null, [{ mediaId: INTRO_ID }]));
      check("video used as photo -> 422", introAsPhoto.status === 422, `status=${introAsPhoto.status}`);
    }

    const noCsrf = await apiPut(buildBody(null, []), { csrf: false });
    check("missing x-vanka-request -> 403", noCsrf.status === 403, `status=${noCsrf.status}`);

    const anonGet = await fetch(`${BASE}/api/archive/gallery`, { headers: { accept: "application/json" } });
    check("unauthenticated GET -> 401", anonGet.status === 401, `status=${anonGet.status}`);

    const anonPut = await fetch(`${BASE}/api/archive/gallery`, {
      method: "PUT",
      headers: { origin: ORIGIN, "content-type": "application/json", "x-vanka-request": "1" },
      body: JSON.stringify({ introMediaId: null, photos: [] }),
    });
    check("unauthenticated PUT -> 401", anonPut.status === 401, `status=${anonPut.status}`);
  } finally {
    if (RESTORE) {
      const restored = await apiPut({
        introMediaId: baseData.introMediaId ?? null,
        photos: (baseData.photos ?? []).map((p) => ({
          mediaId: p.mediaId,
          title: p.title,
          description: p.description,
          memoryDate: p.memoryDate,
        })),
      });
      console.log(`INFO  restored baseline gallery (status=${restored.status})`);
    } else {
      console.log("INFO  VANKA_RESTORE_BASELINE=0 — baseline NOT restored");
    }
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.log(`ERROR: ${err?.message ?? err}`);
  process.exit(1);
});
