import { getPool } from "@/lib/db";
import {
  registerMediaReferenceProbe,
  type MediaReference,
} from "@/lib/media/references";

export const BIRTHDAY_MUSIC_REFERENCE_SOURCE = "birthday_music";

/** Return a reference for any attached song, including unpublished candidates. */
export async function findBirthdayMusicMediaReferences(
  mediaId: string,
): Promise<MediaReference[]> {
  const { rows } = await getPool().query<{ year: number }>(
    `SELECT e.year
       FROM birthday_music m
       JOIN birthday_editions e ON e.id = m.edition_id
      WHERE m.media_id = $1
      LIMIT 1`,
    [mediaId],
  );

  if (!rows[0]) return [];
  return [
    {
      source: BIRTHDAY_MUSIC_REFERENCE_SOURCE,
      detail: `Musik ulang tahun edisi ${rows[0].year}`,
    },
  ];
}

let registered = false;

/** Register the probe once so media deletion protects attached music. */
export function registerBirthdayMusicReferenceProbe(): void {
  if (registered) return;
  registered = true;
  registerMediaReferenceProbe(findBirthdayMusicMediaReferences);
}

registerBirthdayMusicReferenceProbe();
