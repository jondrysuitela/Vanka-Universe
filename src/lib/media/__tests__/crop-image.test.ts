// @vitest-environment jsdom
import "../../../app/__tests__/jsdom-stubs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createScrapbookCrop,
  imageCropRect,
  SCRAPBOOK_CROP_ASPECT,
} from "@/lib/media/crop-image";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("imageCropRect", () => {
  it("creates a centered 4:5 crop from a landscape image", () => {
    const crop = imageCropRect(2400, 1600, { zoom: 1, x: 0, y: 0 });

    expect(crop.width / crop.height).toBeCloseTo(SCRAPBOOK_CROP_ASPECT);
    expect(crop.height).toBe(1600);
    expect(crop.x).toBe(560);
    expect(crop.y).toBe(0);
  });

  it("creates a centered 4:5 crop from a portrait image", () => {
    const crop = imageCropRect(1200, 2000, { zoom: 1, x: 0, y: 0 });

    expect(crop.width / crop.height).toBeCloseTo(SCRAPBOOK_CROP_ASPECT);
    expect(crop.width).toBe(1200);
    expect(crop.y).toBe(250);
  });

  it("moves the crop window toward the opposite side of the image", () => {
    const left = imageCropRect(2400, 1600, { zoom: 1, x: 1, y: 0 });
    const right = imageCropRect(2400, 1600, { zoom: 1, x: -1, y: 0 });

    expect(left.x).toBe(0);
    expect(right.x + right.width).toBe(2400);
  });

  it("zooms around the center and clamps invalid pan and zoom values", () => {
    const crop = imageCropRect(1600, 2000, { zoom: 2, x: 4, y: -4 });

    expect(crop.width).toBe(800);
    expect(crop.height).toBe(1000);
    expect(crop.x).toBe(0);
    expect(crop.y + crop.height).toBe(2000);
    expect(() => imageCropRect(0, 2000, { zoom: 1, x: 0, y: 0 })).toThrow(
      "Foto tidak memiliki dimensi yang valid.",
    );
  });
});

describe("createScrapbookCrop", () => {
  it("creates a cropped output file without modifying the source file", async () => {
    const source = new File(["original"], "vanka.png", { type: "image/png" });
    const bitmap = { width: 2400, height: 1600, close: vi.fn() };
    const drawImage = vi.fn();
    const context = {
      drawImage,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low" as ImageSmoothingQuality,
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue(bitmap as unknown as ImageBitmap),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) => {
      callback(new Blob(["cropped"], { type: type ?? "image/png" }));
    });

    const cropped = await createScrapbookCrop(source, { zoom: 1, x: 0, y: 0 });

    expect(cropped.name).toBe("vanka-scrapbook.png");
    expect(cropped.type).toBe("image/png");
    expect(source.name).toBe("vanka.png");
    expect(await source.text()).toBe("original");
    expect(drawImage).toHaveBeenCalledWith(bitmap, 560, 0, 1280, 1600, 0, 0, 1280, 1600);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
