import { Buffer } from "node:buffer";

import { ApiError } from "@/lib/auth/guard";
import { MIME_MAP, sniffMime } from "@/lib/media/storage/mime";
import type { MediaRecord } from "@/lib/media/storage/types";
import { MAX_IMAGE_BYTES } from "@/lib/media/storage/types";

const REPLACEABLE_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function readReplacementImage(file: File, record: MediaRecord): Promise<Buffer> {
  if (record.kind !== "image" || !REPLACEABLE_IMAGE_MIMES.has(record.mime)) {
    throw new ApiError(415, "IMAGE_CROP_UNSUPPORTED", "Hanya foto JPEG, PNG, dan WebP yang dapat di-crop.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime || MIME_MAP[mime]?.kind !== "image") {
    throw new ApiError(415, "UNSUPPORTED_TYPE", "Hasil crop bukan file gambar yang valid.");
  }
  if (mime !== record.mime) {
    throw new ApiError(422, "IMAGE_TYPE_MISMATCH", "Format hasil crop harus sama dengan foto asli.");
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran foto hasil crop melebihi 10 MB.");
  }

  return bytes;
}
