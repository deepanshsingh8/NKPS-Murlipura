"use client";

import { useState, useCallback, useRef } from "react";
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";

export type { Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Button } from "@nkps/shared/components/ui/button";
import { RotateCcw, Check, X, Maximize, CopyCheck } from "lucide-react";

interface ImageCropperProps {
  /** The image source URL (object URL or data URL) */
  imageSrc: string;
  /** Called with the cropped image File when user confirms */
  onCropComplete: (croppedFile: File) => void;
  /** Called when user cancels cropping */
  onCancel: () => void;
  /** Output file name (default: "cropped.jpg") */
  fileName?: string;
  /** Crop shape: "round" for profile photos, "rect" for general images (default: "rect") */
  cropShape?: "round" | "rect";
  /** Aspect ratio for the crop area (default: free crop via 0, or e.g. 16/9, 4/3, 1) */
  aspect?: number;
  /** If provided, shows a "Crop All" button for batch operations. Called with the current percentage-based crop. */
  onCropAll?: (percentCrop: Crop) => void;
}

/**
 * Extracts the cropped region from the image using canvas.
 * Scales pixel-crop coordinates from displayed size to natural size.
 */
async function getCroppedImg(
  image: HTMLImageElement,
  pixelCrop: PixelCrop,
  fileName: string
): Promise<File> {
  // react-image-crop returns pixel values relative to the displayed <img> size.
  // Scale them to the image's natural (full-resolution) dimensions.
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;

  const sx = Math.round(pixelCrop.x * scaleX);
  const sy = Math.round(pixelCrop.y * scaleY);
  const sw = Math.round(pixelCrop.width * scaleX);
  const sh = Math.round(pixelCrop.height * scaleY);

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (resultBlob) => {
        if (!resultBlob) {
          reject(new Error("Canvas is empty"));
          return;
        }
        resolve(new File([resultBlob], fileName, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  });
}

/**
 * Creates a centered crop with the given aspect ratio.
 */
function makeCenteredCrop(
  width: number,
  height: number,
  aspect: number
): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 90 }, aspect, width, height),
    width,
    height
  );
}

export function ImageCropper({
  imageSrc,
  onCropComplete,
  onCancel,
  fileName = "cropped.jpg",
  cropShape = "rect",
  aspect,
  onCropAll,
}: ImageCropperProps) {
  const isRound = cropShape === "round";
  const effectiveAspect = aspect || (isRound ? 1 : undefined);

  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [processing, setProcessing] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
      imgRef.current = e.currentTarget;

      if (effectiveAspect) {
        setCrop(makeCenteredCrop(w, h, effectiveAspect));
      } else {
        // Default: select the full image
        setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
      }
    },
    [effectiveAspect]
  );

  const handleSelectAll = () => {
    if (!imgRef.current) return;
    const { naturalWidth: w, naturalHeight: h } = imgRef.current;
    if (effectiveAspect) {
      setCrop(makeCenteredCrop(w, h, effectiveAspect));
    } else {
      setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
    }
  };

  const handleConfirm = async () => {
    if (!completedCrop || !imgRef.current) return;
    setProcessing(true);
    try {
      const croppedFile = await getCroppedImg(
        imgRef.current,
        completedCrop,
        fileName
      );
      onCropComplete(croppedFile);
    } catch (err) {
      console.error("Crop failed:", err);
    } finally {
      setProcessing(false);
    }
  };

  const handleCropAll = () => {
    if (!crop || !onCropAll) return;
    const percentCrop: Crop = crop.unit === "%"
      ? crop
      : imgRef.current
        ? {
            unit: "%" as const,
            x: (crop.x / imgRef.current.width) * 100,
            y: (crop.y / imgRef.current.height) * 100,
            width: (crop.width / imgRef.current.width) * 100,
            height: (crop.height / imgRef.current.height) * 100,
          }
        : crop;
    onCropAll(percentCrop);
  };

  return (
    <div className="space-y-4">
      {/* Crop area */}
      <div className="relative w-full max-h-[420px] overflow-auto rounded-xl bg-gray-900 flex items-center justify-center p-2">
        <ReactCrop
          crop={crop}
          onChange={(c) => setCrop(c)}
          onComplete={(c) => setCompletedCrop(c)}
          aspect={effectiveAspect}
          circularCrop={isRound}
          className="max-h-[400px]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt="Crop preview"
            onLoad={onImageLoad}
            className="max-h-[400px] w-auto"
            style={{ display: "block" }}
          />
        </ReactCrop>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={handleSelectAll}
          title="Reset selection"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Reset
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => {
            if (!imgRef.current) return;
            setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
          }}
          title="Select entire image"
        >
          <Maximize className="h-3.5 w-3.5 mr-1.5" />
          Select All
        </Button>
      </div>

      <p className="text-xs text-center text-gray-400">
        {isRound
          ? "Drag the selection to choose the area for the profile photo."
          : "Drag to create a selection, or resize the handles to adjust."}
      </p>

      {/* Action buttons */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} size="sm">
          <X className="h-4 w-4 mr-1" />
          Cancel
        </Button>
        {onCropAll && (
          <Button
            type="button"
            variant="outline"
            onClick={handleCropAll}
            disabled={processing || !crop}
            size="sm"
            className="text-violet-600 border-violet-300 hover:bg-violet-50"
          >
            <CopyCheck className="h-4 w-4 mr-1" />
            Crop All
          </Button>
        )}
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={processing || !completedCrop}
          size="sm"
        >
          <Check className="h-4 w-4 mr-1" />
          {processing ? "Cropping..." : "Confirm Crop"}
        </Button>
      </div>
    </div>
  );
}
