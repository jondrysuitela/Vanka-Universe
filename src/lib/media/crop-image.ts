export const SCRAPBOOK_CROP_ASPECT = 4 / 5;
const CROPPED_IMAGE_MAX_EDGE = 1600;

export interface ImageCropPosition {
  zoom: number;
  x: number;
  y: number;
}

export interface ImageCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Returns the source-pixel rectangle for a 4:5 crop and normalized pan. */
export function imageCropRect(
  sourceWidth: number,
  sourceHeight: number,
  position: ImageCropPosition,
): ImageCropRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Foto tidak memiliki dimensi yang valid.");
  }

  const sourceAspect = sourceWidth / sourceHeight;
  let width = sourceWidth;
  let height = sourceHeight;
  if (sourceAspect > SCRAPBOOK_CROP_ASPECT) {
    width = sourceHeight * SCRAPBOOK_CROP_ASPECT;
  } else {
    height = sourceWidth / SCRAPBOOK_CROP_ASPECT;
  }

  const zoom = clamp(Number.isFinite(position.zoom) ? position.zoom : 1, 1, 3);
  width /= zoom;
  height /= zoom;
  const maxX = (sourceWidth - width) / 2;
  const maxY = (sourceHeight - height) / 2;
  const panX = clamp(Number.isFinite(position.x) ? position.x : 0, -1, 1);
  const panY = clamp(Number.isFinite(position.y) ? position.y : 0, -1, 1);

  return {
    x: clamp(maxX * (1 - panX), 0, sourceWidth - width),
    y: clamp(maxY * (1 - panY), 0, sourceHeight - height),
    width,
    height,
  };
}

function outputTypeFor(type: string): "image/jpeg" | "image/png" | "image/webp" {
  if (type === "image/png") return "image/png";
  if (type === "image/webp") return "image/webp";
  return "image/jpeg";
}

function outputName(name: string, type: string): string {
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return `${name.replace(/\.[^./\\]+$/, "")}-scrapbook.${extension}`;
}

/** Creates an upload-ready cropped copy; the selected source File is untouched. */
export async function createScrapbookCrop(
  file: File,
  position: ImageCropPosition,
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const crop = imageCropRect(bitmap.width, bitmap.height, position);
    const scale = Math.min(1, CROPPED_IMAGE_MAX_EDGE / Math.max(crop.width, crop.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.width * scale));
    canvas.height = Math.max(1, Math.round(crop.height * scale));

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser tidak dapat memproses crop foto.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const type = outputTypeFor(file.type);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, 0.92);
    });
    if (!blob || blob.size === 0) {
      throw new Error("Crop foto gagal dibuat. Coba pilih foto lain.");
    }

    return new File([blob], outputName(file.name, type), {
      type,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
