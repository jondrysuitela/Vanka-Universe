/**
 * Vanka Birthday Universe — Annual Theme Registry (Tahap 4G.8A).
 *
 * Single source of truth for the birthday theme of each age, 1 → 17. This is
 * pure METADATA: it deliberately holds NO edition content, NO letter text, and
 * NO media/collection. Those stay separate (`LetterScene`, the media store,
 * and future edition content) so a later theme can never rewrite an earlier
 * archive.
 *
 * STORAGE LIMITATION (documented, not hidden):
 *   This registry is a STATIC in-code catalog. There is no edition/theme table
 *   in the database yet, so nothing here is persisted on the server. Enough to
 *   plan and to build each theme separately later — not a finished visual
 *   experience. Only age 1 has a built experience today; every other entry is
 *   `readiness: "concept"`.
 *
 * Identity: every theme has a stable `id`, `slug`, and `age`. Changing a future
 * theme must never change a past one.
 */

/** Vanka's birth date. The first birthday is 27 October 2026. */
export const BIRTH_DATE = { year: 2025, month: 10, day: 27 } as const;

/** Age of the currently-built experience. */
export const FIRST_THEME_AGE = 1;

/** Age span covered by the registry. */
export const THEME_MIN_AGE = 1;
export const THEME_MAX_AGE = 17;

const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

/**
 * Birthday year for a given age. Age 1 → 2026, age 17 → 2042.
 * Derived from the birth date so the calculation can never drift.
 */
export function birthdayYear(age: number): number {
  return BIRTH_DATE.year + age;
}

/** e.g. age 1 → "27 Oktober 2026". */
export function formatBirthdayDate(age: number): string {
  return `${BIRTH_DATE.day} ${MONTHS_ID[BIRTH_DATE.month - 1]} ${birthdayYear(age)}`;
}

/** e.g. age 1 → "2026-10-27". */
export function birthdayIsoDate(age: number): string {
  const mm = String(BIRTH_DATE.month).padStart(2, "0");
  const dd = String(BIRTH_DATE.day).padStart(2, "0");
  return `${birthdayYear(age)}-${mm}-${dd}`;
}

/**
 * Implementation readiness. Distinguishes a theme that is actually BUILT from
 * one that only exists as a concept in this catalog.
 *   - "implemented": a working experience exists for this age today.
 *   - "concept":     metadata/design only; no experience built yet.
 */
export type ThemeReadiness = "implemented" | "concept";

export interface ThemePalette {
  /** Main dark surface. */
  primary: string;
  /** Secondary tone. */
  secondary: string;
  /** Highlight / gold-equivalent accent. */
  accent: string;
  /** Panel / card surface. */
  surface: string;
  /** Primary text colour on the surface. */
  text: string;
  /** Three-stop gradient (darkest → mid → tone). */
  gradient: readonly [string, string, string];
}

export interface BirthdayTheme {
  /** Stable identity, e.g. "vanka-birthday-01". */
  id: string;
  /** Age celebrated by this theme (1–17). */
  age: number;
  /** Display title (proper noun — kept verbatim). */
  title: string;
  /** Short Indonesian subtitle. */
  subtitle: string;
  /** Birthday year (full) derived from the birth date. */
  year: number;
  /** Stable URL-safe identifier. */
  slug: string;
  /** Concept description of the theme. */
  concept: string;
  /** Colour palette. */
  palette: ThemePalette;
  /** Background concept. */
  background: string;
  /** Animation concept. */
  animation: string;
  /** Transition concept between scenes. */
  transition: string;
  /** Opening concept. */
  opening: string;
  /** Letter experience concept. */
  letter: string;
  /** Memory gallery concept. */
  gallery: string;
  /** Implementation readiness. */
  readiness: ThemeReadiness;
  /** Honest note on what is actually built vs still just a concept. */
  readinessNote: string;
}

/**
 * The 17 annual themes. Order is by age ascending. Do NOT reorder or renumber
 * existing entries — each is a permanent archive identity.
 */
export const BIRTHDAY_THEMES: readonly BirthdayTheme[] = [
  {
    id: "vanka-birthday-01",
    age: 1,
    title: "Vanka's First Universe",
    subtitle: "Semesta pertama Vanka",
    year: birthdayYear(1),
    slug: "vanka-first-universe",
    concept:
      "Semesta kelahiran pertama: hadiah pembuka, surat dari Ayah, dan kotak kenangan yang menghubungkan setiap momen kecil menjadi bintang.",
    palette: {
      primary: "#0b1226",
      secondary: "#1b2f5e",
      accent: "#e9c67c",
      surface: "#0a1330",
      text: "#fdf3d8",
      gradient: ["#04060f", "#0b1226", "#1b2f5e"],
    },
    background: "Langit malam berbintang dengan aurora lembut dan vignette sinematik.",
    animation: "Bintang berkelip halus, partikel cahaya saat kotak hadiah terbuka.",
    transition: "Fade lembut antar scene dengan sedikit skala.",
    opening: "Kotak hadiah yang terbuka, lalu frame thumbnail foto pembuka.",
    letter: "Amplop sinematik, lalu surat Ayah dibagi menjadi enam bagian berurutan.",
    gallery: "Kotak kenangan kedua yang terbuka menjadi galeri foto/video dengan judul dan deskripsi.",
    readiness: "implemented",
    readinessNote:
      "Pengalaman ulang tahun pertama sudah dibangun: kotak hadiah → pembuka (thumbnail) → surat → kotak kenangan → galeri. Galeri masih menampilkan placeholder jujur sampai ada media publik asli.",
  },
  {
    id: "vanka-birthday-02",
    age: 2,
    title: "Little Garden of Wonders",
    subtitle: "Taman kecil penuh keajaiban",
    year: birthdayYear(2),
    slug: "little-garden-of-wonders",
    concept: "Taman yang tumbuh selama satu tahun: setiap langkah kecil mekar menjadi bunga dan daun.",
    palette: {
      primary: "#173a2a",
      secondary: "#2f6b45",
      accent: "#f2b8c6",
      surface: "#0f2618",
      text: "#eafbe7",
      gradient: ["#0b1f14", "#173a2a", "#2f6b45"],
    },
    background: "Padang hijau lembut dengan hangat cahaya pagi dan serbuk sari melayang.",
    animation: "Tunas tumbuh dan kelopak terbuka mengikuti kemunculan scene.",
    transition: "Scene menyilang seperti kelopak yang berganti.",
    opening: "Benih kecil yang tumbuh menjadi taman saat disentuh.",
    letter: "Surat ditulis di daun besar yang perlahan terbuka.",
    gallery: "Galeri berbentuk papan bunga tempat setiap kenangan menjadi sekuntum bunga.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 2 yang dibangun.",
  },
  {
    id: "vanka-birthday-03",
    age: 3,
    title: "Once Upon a Little Star",
    subtitle: "Kisah bintang kecil",
    year: birthdayYear(3),
    slug: "once-upon-a-little-star",
    concept: "Kisah dongeng tentang bintang kecil yang belajar bersinar di langit malam.",
    palette: {
      primary: "#101a3a",
      secondary: "#26356e",
      accent: "#ffd76e",
      surface: "#0a1230",
      text: "#fff6da",
      gradient: ["#070b1f", "#101a3a", "#26356e"],
    },
    background: "Langit dongeng dengan buku cerita terbuka dan bintang bergantungan.",
    animation: "Bintang kecil meluncur dari satu halaman ke halaman lain.",
    transition: "Halaman buku terangkat saat berpindah scene.",
    opening: "Sampul buku cerita terbuka menjadi scene pertama.",
    letter: "Surat disampaikan sebagai halaman cerita bergambar.",
    gallery: "Galeri sebagai lembar-lembar album dongeng.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 3 yang dibangun.",
  },
  {
    id: "vanka-birthday-04",
    age: 4,
    title: "The Sky Is My Playground",
    subtitle: "Langit adalah taman bermainku",
    year: birthdayYear(4),
    slug: "the-sky-is-my-playground",
    concept: "Bermain di antara awan: melompat, melayang, dan menemukan bentuk di langit.",
    palette: {
      primary: "#0d2b4a",
      secondary: "#2f6fa6",
      accent: "#bfe3ff",
      surface: "#08203a",
      text: "#eaf6ff",
      gradient: ["#06182b", "#0d2b4a", "#2f6fa6"],
    },
    background: "Langit biru terang dengan awan kapas yang bergerak lambat.",
    animation: "Awan melayang dan memantul halus mengikuti gerak pengguna.",
    transition: "Scene bergeser seperti melayang di antara awan.",
    opening: "Melompat ke awan pertama yang menampilkan judul.",
    letter: "Surat ditulis di atas awan dengan amplop kertas ringan.",
    gallery: "Galeri sebagai deretan awan foto.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 4 yang dibangun.",
  },
  {
    id: "vanka-birthday-05",
    age: 5,
    title: "Secrets of the Blue Ocean",
    subtitle: "Rahasia samudra biru",
    year: birthdayYear(5),
    slug: "secrets-of-the-blue-ocean",
    concept: "Menyelam mencari rahasia samudra: terumbu, gelembung, dan cahaya bawah laut.",
    palette: {
      primary: "#04263a",
      secondary: "#0a5a6b",
      accent: "#5fd0c8",
      surface: "#021b2a",
      text: "#d9fbf8",
      gradient: ["#01131f", "#04263a", "#0a5a6b"],
    },
    background: "Kedalaman laut bergradasi dengan cahaya menembus permukaan.",
    animation: "Gelembung naik dan arus pelan menggerakkan tanaman laut.",
    transition: "Scene menyelam turun dan naik.",
    opening: "Permukaan air terbelah menuju kedalaman.",
    letter: "Surat dalam botol yang terbuka di dasar laut.",
    gallery: "Galeri sebagai gua terumbu berisi kenangan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 5 yang dibangun.",
  },
  {
    id: "vanka-birthday-06",
    age: 6,
    title: "The Little Explorer",
    subtitle: "Penjelajah kecil",
    year: birthdayYear(6),
    slug: "the-little-explorer",
    concept: "Petualangan dengan peta, kompas, dan jejak kaki menuju tempat baru.",
    palette: {
      primary: "#2a2415",
      secondary: "#6b5327",
      accent: "#f0a24b",
      surface: "#1d1a10",
      text: "#fbefdb",
      gradient: ["#15110a", "#2a2415", "#6b5327"],
    },
    background: "Peta petualangan tua dengan garis rute dan cahaya hangat.",
    animation: "Jejak kaki muncul mengikuti perjalanan antar scene.",
    transition: "Scene bergulir seperti membuka gulungan peta.",
    opening: "Kompas berputar lalu menunjuk titik awal.",
    letter: "Surat sebagai catatan perjalanan di buku harian ekspedisi.",
    gallery: "Galeri sebagai papan penemuan dengan foto perjalanan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 6 yang dibangun.",
  },
  {
    id: "vanka-birthday-07",
    age: 7,
    title: "A Thousand Colors of You",
    subtitle: "Seribu warna tentangmu",
    year: birthdayYear(7),
    slug: "a-thousand-colors-of-you",
    concept: "Perayaan warna: setiap suasana hati dan momen punya warnanya sendiri.",
    palette: {
      primary: "#2a1030",
      secondary: "#7a2f8f",
      accent: "#ff8ac4",
      surface: "#1b0a22",
      text: "#ffe9f7",
      gradient: ["#150718", "#2a1030", "#7a2f8f"],
    },
    background: "Latar gradasi warna yang mengalir dan berubah perlahan.",
    animation: "Percikan warna menyebar setiap pergantian scene.",
    transition: "Wipe warna menyapu layar antar scene.",
    opening: "Palet cat tumpah membentuk judul.",
    letter: "Surat ditulis dengan tinta warna-warni.",
    gallery: "Galeri sebagai mozaik warna kenangan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 7 yang dibangun.",
  },
  {
    id: "vanka-birthday-08",
    age: 8,
    title: "The Little Astronomer",
    subtitle: "Astronom kecil",
    year: birthdayYear(8),
    slug: "the-little-astronomer",
    concept: "Mengamati langit dengan teleskop dan menamai bintang pertama.",
    palette: {
      primary: "#070f2b",
      secondary: "#1c2c63",
      accent: "#9fd0ff",
      surface: "#050a1f",
      text: "#e8f1ff",
      gradient: ["#03060f", "#070f2b", "#1c2c63"],
    },
    background: "Langit malam jernih dengan rasi bintang dan teleskop.",
    animation: "Teleskop bergerak mencari dan bintang menyala.",
    transition: "Zoom bintang menjadi scene berikutnya.",
    opening: "Lensa teleskop menyorot judul.",
    letter: "Surat sebagai catatan pengamatan langit.",
    gallery: "Galeri sebagai peta bintang kenangan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 8 yang dibangun.",
  },
  {
    id: "vanka-birthday-09",
    age: 9,
    title: "The Secret Library",
    subtitle: "Perpustakaan rahasia",
    year: birthdayYear(9),
    slug: "the-secret-library",
    concept: "Perpustakaan tersembunyi tempat setiap buku menyimpan satu kenangan.",
    palette: {
      primary: "#241a12",
      secondary: "#5a3d24",
      accent: "#e0b56e",
      surface: "#17100a",
      text: "#f7e8d2",
      gradient: ["#120c07", "#241a12", "#5a3d24"],
    },
    background: "Rak buku kayu tinggi dengan cahaya lampu baca hangat.",
    animation: "Buku melayang turun dari rak saat scene berganti.",
    transition: "Halaman buku berputar sebagai transisi.",
    opening: "Kunci memutar dan pintu perpustakaan terbuka.",
    letter: "Surat sebagai buku catatan bersampul kulit.",
    gallery: "Galeri sebagai rak buku kenangan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 9 yang dibangun.",
  },
  {
    id: "vanka-birthday-10",
    age: 10,
    title: "A Decade of Wonder",
    subtitle: "Satu dekade penuh keajaiban",
    year: birthdayYear(10),
    slug: "a-decade-of-wonder",
    concept: "Perayaan satu dekade: sepuluh tahun cahaya dalam satu pesta.",
    palette: {
      primary: "#211246",
      secondary: "#4a2a8f",
      accent: "#ffd166",
      surface: "#170c33",
      text: "#fff2d6",
      gradient: ["#0f0730", "#211246", "#4a2a8f"],
    },
    background: "Balon, konfeti, dan gradasi ungu keemasan.",
    animation: "Konfeti meledak di awal setiap scene.",
    transition: "Kilatan konfeti menutup perpindahan scene.",
    opening: "Hitungan mundur angka 10 lalu konfeti.",
    letter: "Surat sebagai kartu ulang tahun besar.",
    gallery: "Galeri sebagai meja pesta dengan kenangan dekade.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 10 yang dibangun.",
  },
  {
    id: "vanka-birthday-11",
    age: 11,
    title: "Beneath the Northern Lights",
    subtitle: "Di bawah cahaya utara",
    year: birthdayYear(11),
    slug: "beneath-the-northern-lights",
    concept: "Berdiri di bawah aurora yang menari di langit malam utara.",
    palette: {
      primary: "#04231f",
      secondary: "#0f4a55",
      accent: "#86f7c1",
      surface: "#031a17",
      text: "#e6fff6",
      gradient: ["#02120f", "#04231f", "#7a5cff"],
    },
    background: "Pita aurora hijau-ungu bergerak di atas cakrawala salju.",
    animation: "Aurora mengalir dan berdenyut lembut.",
    transition: "Cahaya aurora menyapu antar scene.",
    opening: "Cakrawala malam terbuka memperlihatkan judul.",
    letter: "Surat sebagai catatan malam di bawah aurora.",
    gallery: "Galeri sebagai jendela kabin yang memandang kenangan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 11 yang dibangun.",
  },
  {
    id: "vanka-birthday-12",
    age: 12,
    title: "The Moonlight Chronicles",
    subtitle: "Kisah di bawah sinar bulan",
    year: birthdayYear(12),
    slug: "the-moonlight-chronicles",
    concept: "Catatan perjalanan yang hanya terbaca dalam cahaya bulan.",
    palette: {
      primary: "#0a1230",
      secondary: "#2a3566",
      accent: "#dfe6ff",
      surface: "#070c22",
      text: "#f2f5ff",
      gradient: ["#050818", "#0a1230", "#2a3566"],
    },
    background: "Bulan purnama dengan perak di atas permukaan tenang.",
    animation: "Silau perak bergerak pelan di atas latar.",
    transition: "Fade perak antar scene.",
    opening: "Bulan terbit di balik cakrawala.",
    letter: "Surat ditulis dengan tinta perak bercahaya.",
    gallery: "Galeri sebagai halaman kronik berilustrasi bulan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 12 yang dibangun.",
  },
  {
    id: "vanka-birthday-13",
    age: 13,
    title: "Becoming My Own Horizon",
    subtitle: "Menjadi cakrawalaku sendiri",
    year: birthdayYear(13),
    slug: "becoming-my-own-horizon",
    concept: "Menatap cakrawala sendiri: tumbuh, memilih, dan melangkah.",
    palette: {
      primary: "#2a1420",
      secondary: "#7a2f3f",
      accent: "#ffb27a",
      surface: "#1d0d16",
      text: "#ffece0",
      gradient: ["#15080f", "#2a1420", "#7a2f3f"],
    },
    background: "Cakrawala matahari terbit hangat dengan garis langit membentang.",
    animation: "Matahari naik perlahan seiring kemajuan.",
    transition: "Garis horizon bergeser antar scene.",
    opening: "Fajar menyingsing membuka pengalaman.",
    letter: "Surat sebagai refleksi di tepi pantai.",
    gallery: "Galeri sebagai deretan cakrawala kenangan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 13 yang dibangun.",
  },
  {
    id: "vanka-birthday-14",
    age: 14,
    title: "Constellations of My Dreams",
    subtitle: "Konstelasi mimpi-mimpiku",
    year: birthdayYear(14),
    slug: "constellations-of-my-dreams",
    concept: "Menghubungkan titik-titik mimpi menjadi satu konstelasi.",
    palette: {
      primary: "#12082e",
      secondary: "#2f1f6b",
      accent: "#7fe3ff",
      surface: "#0b051f",
      text: "#e9f4ff",
      gradient: ["#080318", "#12082e", "#2f1f6b"],
    },
    background: "Langit violet dalam dengan garis konstelasi yang menyala.",
    animation: "Garis konstelasi muncul menghubungkan bintang.",
    transition: "Bintang menyambar menjadi scene berikutnya.",
    opening: "Konstelasi menggambar judul di langit.",
    letter: "Surat sebagai peta mimpi.",
    gallery: "Galeri sebagai atlas konstelasi kenangan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 14 yang dibangun.",
  },
  {
    id: "vanka-birthday-15",
    age: 15,
    title: "The Courage to Become",
    subtitle: "Keberanian untuk bertumbuh",
    year: birthdayYear(15),
    slug: "the-courage-to-become",
    concept: "Keberanian mengambil langkah baru dan menjadi versi diri yang lebih berani.",
    palette: {
      primary: "#2a0d0d",
      secondary: "#7a1f1f",
      accent: "#ff8a5c",
      surface: "#1c0808",
      text: "#ffe6dc",
      gradient: ["#160606", "#2a0d0d", "#7a1f1f"],
    },
    background: "Api unggun hangat dan gradasi merah membara.",
    animation: "Percikan api naik saat scene berubah.",
    transition: "Panas menghangat melewati tiap scene.",
    opening: "Bara menyala menerangi judul.",
    letter: "Surat sebagai surat keberanian yang ditulis dengan tegas.",
    gallery: "Galeri sebagai dinding pencapaian.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 15 yang dibangun.",
  },
  {
    id: "vanka-birthday-16",
    age: 16,
    title: "Letters Across Time",
    subtitle: "Surat melintasi waktu",
    year: birthdayYear(16),
    slug: "letters-across-time",
    concept: "Kumpulan surat yang melintasi waktu, dari masa kecil sampai masa depan.",
    palette: {
      primary: "#26201a",
      secondary: "#5c4a33",
      accent: "#d8c58f",
      surface: "#1a150f",
      text: "#f5ecd8",
      gradient: ["#120e0a", "#26201a", "#5c4a33"],
    },
    background: "Meja kayu dengan tumpukan surat tua dan segel lilin.",
    animation: "Surat tua terangkat dan terbuka satu per satu.",
    transition: "Surat melipat dan berpindah sebagai transisi.",
    opening: "Segel lilin pecah membuka pengalaman.",
    letter: "Pengalaman surat menjadi inti: arsip surat lintas waktu.",
    gallery: "Galeri sebagai kotak arsip kenangan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 16 yang dibangun.",
  },
  {
    id: "vanka-birthday-17",
    age: 17,
    title: "The Universe Ahead",
    subtitle: "Semesta yang menanti",
    year: birthdayYear(17),
    slug: "the-universe-ahead",
    concept: "Menatap semesta yang luas di depan: gerbang menuju masa depan.",
    palette: {
      primary: "#050b22",
      secondary: "#16306b",
      accent: "#a9c9ff",
      surface: "#03081a",
      text: "#eaf2ff",
      gradient: ["#02040f", "#050b22", "#16306b"],
    },
    background: "Galaksi jauh dengan nebula biru dan bintang terang.",
    animation: "Bintang melaju seperti menembus ruang.",
    transition: "Warp cahaya antar scene.",
    opening: "Gerbang galaksi terbuka menuju judul.",
    letter: "Surat sebagai pesan untuk masa depan.",
    gallery: "Galeri sebagai peta semesta kenangan.",
    readiness: "concept",
    readinessNote: "Metadata/desain saja. Belum ada pengalaman usia 17 yang dibangun.",
  },
];

/** Look up a theme by age. Returns `undefined` for an unknown age. */
export function getThemeByAge(age: number): BirthdayTheme | undefined {
  return BIRTHDAY_THEMES.find((theme) => theme.age === age);
}

/** Look up a theme by its stable slug. Returns `undefined` if unknown. */
export function getThemeBySlug(slug: string): BirthdayTheme | undefined {
  return BIRTHDAY_THEMES.find((theme) => theme.slug === slug);
}
