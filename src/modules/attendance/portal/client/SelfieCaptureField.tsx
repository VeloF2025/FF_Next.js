/**
 * Selfie capture field for /my/register — extracted from RegisterProfileForm to
 * keep the parent component under 200 lines.
 */
import React from 'react';
import { Camera, RefreshCw } from 'lucide-react';

import { fileToResizedBase64 } from '@/modules/attendance/portal/client/imageUtils';

interface Props {
  selfiePreview: string | null;
  onCapture: (base64: string, previewUrl: string) => void;
  onError: (msg: string) => void;
  labelClass: string;
}

export function SelfieCaptureField({ selfiePreview, onCapture, onError, labelClass }: Props) {
  const cameraRef = React.useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    try {
      const b64 = await fileToResizedBase64(file, { maxDimension: 800, quality: 0.7 });
      onCapture(b64, `data:image/jpeg;base64,${b64}`);
    } catch {
      onError('Could not process the photo. Please try again.');
    }
    // Reset input so same file can be re-selected after retake
    e.target.value = '';
  };

  return (
    <div>
      <div className={labelClass}>Selfie (optional)</div>
      <div className="rounded-2xl bg-neutral-900 border border-neutral-800 overflow-hidden">
        {selfiePreview ? (
          <div className="relative">
            <img
              src={selfiePreview}
              alt="Selfie preview"
              className="w-full h-auto aspect-square object-cover"
            />
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="absolute bottom-3 right-3 inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-lg bg-black/70 text-white text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Retake
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="w-full aspect-square bg-neutral-800 flex flex-col items-center justify-center gap-2 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          >
            <Camera className="w-10 h-10" />
            <span className="text-sm font-medium">Tap to take selfie</span>
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-400 mt-2 px-1">
        A clear photo of your face. Helps identify you on site.
      </p>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
