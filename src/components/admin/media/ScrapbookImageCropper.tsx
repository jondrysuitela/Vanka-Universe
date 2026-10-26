"use client";

import { useEffect, useRef, useState } from "react";

import {
  createScrapbookCrop,
  SCRAPBOOK_CROP_ASPECT,
  type ImageCropPosition,
} from "@/lib/media/crop-image";

const INITIAL_CROP: ImageCropPosition = { zoom: 1, x: 0, y: 0 };

function clamp(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

export default function ScrapbookImageCropper({
  file,
  onCancel,
  onApply,
}: {
  file: File;
  onCancel: () => void;
  onApply: (cropped: File) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [position, setPosition] = useState<ImageCropPosition>(INITIAL_CROP);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const frame = requestAnimationFrame(() => setPreviewUrl(url));
    return () => {
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !processing) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, processing]);

  const aspect = dimensions ? dimensions.width / dimensions.height : SCRAPBOOK_CROP_ASPECT;
  const imageSize =
    aspect >= SCRAPBOOK_CROP_ASPECT
      ? { width: `${(aspect / SCRAPBOOK_CROP_ASPECT) * 100}%`, height: "100%" }
      : { width: "100%", height: `${(SCRAPBOOK_CROP_ASPECT / aspect) * 100}%` };
  const maxShiftX = Math.max(
    0,
    (Math.max(1, aspect / SCRAPBOOK_CROP_ASPECT) * position.zoom - 1) * 50,
  );
  const maxShiftY = Math.max(
    0,
    (Math.max(1, SCRAPBOOK_CROP_ASPECT / aspect) * position.zoom - 1) * 50,
  );

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!dimensions) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: position.x,
      panY: position.y,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;

    setPosition((current) => ({
      ...current,
      x:
        maxShiftX === 0
          ? 0
          : clamp(drag.panX + ((event.clientX - drag.x) / bounds.width / (maxShiftX / 50))),
      y:
        maxShiftY === 0
          ? 0
          : clamp(drag.panY + ((event.clientY - drag.y) / bounds.height / (maxShiftY / 50))),
    }));
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  async function applyCrop() {
    if (!dimensions || processing) return;
    setProcessing(true);
    setError(null);
    try {
      onApply(await createScrapbookCrop(file, position));
    } catch (cropError) {
      setError(
        cropError instanceof Error
          ? cropError.message
          : "Crop foto gagal dibuat. Coba pilih foto lain.",
      );
      setProcessing(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scrapbook-crop-title"
      className="fixed inset-0 z-[220] flex items-center justify-center overflow-y-auto bg-[#050814]/90 p-4 backdrop-blur-md"
    >
      <div className="my-auto w-full max-w-xl space-y-5 rounded-2xl border border-[#e9c67c]/35 bg-[#0b1226] p-5 shadow-[0_30px_100px_rgba(0,0,0,0.8)] sm:p-7">
        <div>
          <h2 id="scrapbook-crop-title" className="font-display text-xl text-[#fdf3d8]">
            Sesuaikan foto scrapbook
          </h2>
          <p className="mt-1 text-sm text-[#fdf3d8]/65">
            Geser foto agar wajah masuk area portrait 4:5. Gunakan zoom untuk mengatur komposisi.
          </p>
        </div>

        <div className="flex justify-center">
          <div
            ref={stageRef}
            className="relative w-full max-w-[360px] touch-none cursor-grab overflow-hidden bg-[#17130f] active:cursor-grabbing"
            style={{ aspectRatio: `${SCRAPBOOK_CROP_ASPECT}` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          >
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={`Atur crop ${file.name}`}
                draggable={false}
                onLoad={(event) =>
                  setDimensions({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  ...imageSize,
                  left: `calc(50% + ${position.x * maxShiftX}%)`,
                  top: `calc(50% + ${position.y * maxShiftY}%)`,
                  transform: `translate(-50%, -50%) scale(${position.zoom})`,
                }}
              />
            )}
            <div className="pointer-events-none absolute inset-0 border border-[#f6d77a]/80 shadow-[inset_0_0_0_999px_rgba(5,8,20,0.04)]" />
          </div>
        </div>

        <label className="block text-sm text-[#fdf3d8]/85">
          Zoom foto: {position.zoom.toFixed(1)}×
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={position.zoom}
            onChange={(event) =>
              setPosition((current) => ({
                ...current,
                zoom: Number(event.currentTarget.value),
              }))
            }
            className="mt-2 block w-full accent-[#e9c67c]"
            aria-label="Zoom foto"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-[#fdf3d8]/85">
            Posisi horizontal
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={Math.round(position.x * 100)}
              onChange={(event) =>
                setPosition((current) => ({ ...current, x: Number(event.currentTarget.value) / 100 }))
              }
              className="mt-2 block w-full accent-[#e9c67c]"
              aria-label="Posisi horizontal crop"
            />
          </label>
          <label className="block text-sm text-[#fdf3d8]/85">
            Posisi vertikal
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={Math.round(position.y * 100)}
              onChange={(event) =>
                setPosition((current) => ({ ...current, y: Number(event.currentTarget.value) / 100 }))
              }
              className="mt-2 block w-full accent-[#e9c67c]"
              aria-label="Posisi vertikal crop"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="rounded-lg border border-white/20 px-4 py-2.5 text-sm text-[#fdf3d8]/80 hover:bg-white/5 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void applyCrop()}
            disabled={!dimensions || processing}
            className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] px-5 py-2.5 text-sm font-semibold text-[#050814] disabled:opacity-50"
          >
            {processing ? "Memproses…" : "Gunakan crop 4:5"}
          </button>
        </div>
      </div>
    </div>
  );
}
