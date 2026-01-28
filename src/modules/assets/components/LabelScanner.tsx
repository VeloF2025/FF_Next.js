'use client';

/**
 * LabelScanner Component
 *
 * Scans asset labels to extract or verify information using VLM.
 *
 * Two modes:
 * - extract: Extract asset info from label (for new asset creation)
 * - verify: Compare scanned label against existing asset
 */

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Camera,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Image as ImageIcon,
} from 'lucide-react';
import { modalVariants, overlayVariants } from '@/lib/animations/modal-variants';
import type { AssetLabelExtraction } from '../services/assetVlmService';

// ============================================================================
// TYPES
// ============================================================================

export interface LabelScannerProps {
  /** Whether the scanner modal is open */
  isOpen: boolean;
  /** Close the modal */
  onClose: () => void;
  /** Mode: extract for new assets, verify for existing */
  mode: 'extract' | 'verify';
  /** Asset ID for verify mode */
  assetId?: string;
  /** Callback when extraction completes (extract mode) */
  onExtracted?: (data: AssetLabelExtraction) => void;
  /** Callback when verification completes (verify mode) */
  onVerified?: (result: VerificationResult) => void;
  /** Custom title */
  title?: string;
}

export interface VerificationResult {
  verified: boolean;
  asset: {
    id: string;
    assetNumber: string;
    name: string;
    serialNumber: string | null;
    manufacturer: string | null;
    model: string | null;
  };
  extracted: AssetLabelExtraction;
  comparisons: FieldComparison[];
  mismatches: FieldComparison[];
  confidence: number;
}

interface FieldComparison {
  field: string;
  expected: string | null;
  found: string | null;
  isMatch: boolean;
}

type ScanState = 'idle' | 'capturing' | 'processing' | 'success' | 'error';

// ============================================================================
// COMPONENT
// ============================================================================

export function LabelScanner({
  isOpen,
  onClose,
  mode,
  assetId,
  onExtracted,
  onVerified,
  title,
}: LabelScannerProps) {
  const [state, setState] = useState<ScanState>('idle');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<AssetLabelExtraction | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const displayTitle = title || (mode === 'extract' ? 'Scan Asset Label' : 'Verify Asset Label');

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setState('capturing');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 1280, height: 720 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera error:', err);
      setError('Could not access camera. Please use file upload instead.');
      setState('idle');
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Capture from camera
  const captureFromCamera = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setImagePreview(dataUrl);
    stopCamera();
    processImage(dataUrl);
  }, [stopCamera]);

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImagePreview(dataUrl);
      processImage(dataUrl);
    };
    reader.readAsDataURL(file);
  }, []);

  // Process image with VLM
  const processImage = useCallback(
    async (imageDataUrl: string) => {
      setState('processing');
      setError(null);

      try {
        // Extract base64 from data URL
        const base64 = imageDataUrl.split(',')[1];

        if (mode === 'extract') {
          // Call extraction API
          const response = await fetch('/api/assets/extract-from-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64 }),
          });

          const data = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Extraction failed');
          }

          setExtraction(data.extraction);
          setState('success');
        } else if (mode === 'verify' && assetId) {
          // Call verification API
          const response = await fetch(`/api/assets/${assetId}/verify-label`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64 }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Verification failed');
          }

          setVerification(data);
          setState('success');
        }
      } catch (err) {
        console.error('Processing error:', err);
        setError(err instanceof Error ? err.message : 'Processing failed');
        setState('error');
      }
    },
    [mode, assetId]
  );

  // Reset state
  const handleReset = useCallback(() => {
    setState('idle');
    setImagePreview(null);
    setExtraction(null);
    setVerification(null);
    setError(null);
    stopCamera();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [stopCamera]);

  // Handle confirm
  const handleConfirm = useCallback(() => {
    if (mode === 'extract' && extraction && onExtracted) {
      onExtracted(extraction);
    } else if (mode === 'verify' && verification && onVerified) {
      onVerified(verification);
    }
    onClose();
  }, [mode, extraction, verification, onExtracted, onVerified, onClose]);

  // Cleanup on close
  const handleClose = useCallback(() => {
    stopCamera();
    handleReset();
    onClose();
  }, [stopCamera, handleReset, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-50 bg-black/80"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-4 z-50 flex flex-col bg-slate-900 rounded-2xl overflow-hidden md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[600px] md:max-h-[90vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-blue-400" />
                <h2 className="text-lg font-semibold text-white">{displayTitle}</h2>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Idle State - Show options */}
              {state === 'idle' && (
                <div className="space-y-4">
                  <p className="text-slate-400 text-center mb-6">
                    {mode === 'extract'
                      ? 'Scan or upload a photo of the asset label to extract information'
                      : 'Scan or upload a photo of the asset label to verify details'}
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={startCamera}
                      className="flex flex-col items-center gap-3 p-6 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
                    >
                      <Camera className="w-10 h-10 text-blue-400" />
                      <span className="text-white font-medium">Use Camera</span>
                    </button>

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center gap-3 p-6 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
                    >
                      <Upload className="w-10 h-10 text-green-400" />
                      <span className="text-white font-medium">Upload Image</span>
                    </button>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              )}

              {/* Capturing State - Camera preview */}
              {state === 'capturing' && (
                <div className="space-y-4">
                  <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    {/* Viewfinder overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-64 h-40 border-2 border-blue-400 rounded-lg" />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleReset}
                      className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={captureFromCamera}
                      className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                    >
                      Capture
                    </button>
                  </div>

                  <canvas ref={canvasRef} className="hidden" />
                </div>
              )}

              {/* Processing State */}
              {state === 'processing' && (
                <div className="space-y-4">
                  {imagePreview && (
                    <div className="aspect-video bg-black rounded-lg overflow-hidden">
                      <img
                        src={imagePreview}
                        alt="Captured label"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}
                  <div className="flex flex-col items-center py-6">
                    <RefreshCw className="w-10 h-10 text-blue-400 animate-spin mb-3" />
                    <p className="text-white font-medium">
                      {mode === 'extract' ? 'Extracting information...' : 'Verifying label...'}
                    </p>
                    <p className="text-slate-400 text-sm mt-1">This may take a few seconds</p>
                  </div>
                </div>
              )}

              {/* Success State - Extract Mode */}
              {state === 'success' && mode === 'extract' && extraction && (
                <div className="space-y-4">
                  {imagePreview && (
                    <div className="aspect-video bg-black rounded-lg overflow-hidden">
                      <img
                        src={imagePreview}
                        alt="Captured label"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}

                  <div className="p-4 bg-green-900/30 border border-green-700 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                      <span className="text-green-400 font-medium">Information Extracted</span>
                      <span className="text-slate-400 text-sm ml-auto">
                        Confidence: {Math.round(extraction.confidence * 100)}%
                      </span>
                    </div>

                    <div className="space-y-2 text-sm">
                      <ExtractedField label="Manufacturer" value={extraction.manufacturer} />
                      <ExtractedField label="Model" value={extraction.model} />
                      <ExtractedField label="Serial Number" value={extraction.serialNumber} />
                      <ExtractedField label="Manufacture Date" value={extraction.manufactureDate} />
                      <ExtractedField label="Barcode" value={extraction.barcode} />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleReset}
                      className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                    >
                      Scan Again
                    </button>
                    <button
                      onClick={handleConfirm}
                      className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                    >
                      Use This Data
                    </button>
                  </div>
                </div>
              )}

              {/* Success State - Verify Mode */}
              {state === 'success' && mode === 'verify' && verification && (
                <div className="space-y-4">
                  {imagePreview && (
                    <div className="aspect-video bg-black rounded-lg overflow-hidden">
                      <img
                        src={imagePreview}
                        alt="Captured label"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}

                  <div
                    className={`p-4 rounded-lg border ${
                      verification.verified
                        ? 'bg-green-900/30 border-green-700'
                        : 'bg-yellow-900/30 border-yellow-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      {verification.verified ? (
                        <>
                          <CheckCircle2 className="w-5 h-5 text-green-400" />
                          <span className="text-green-400 font-medium">Verification Passed</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-5 h-5 text-yellow-400" />
                          <span className="text-yellow-400 font-medium">Mismatches Found</span>
                        </>
                      )}
                    </div>

                    <div className="space-y-2 text-sm">
                      {verification.comparisons.map((comp) => (
                        <ComparisonField key={comp.field} comparison={comp} />
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleReset}
                      className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                    >
                      Scan Again
                    </button>
                    <button
                      onClick={handleConfirm}
                      className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                    >
                      {verification.verified ? 'Confirm Verified' : 'Accept Anyway'}
                    </button>
                  </div>
                </div>
              )}

              {/* Error State */}
              {state === 'error' && (
                <div className="space-y-4">
                  {imagePreview && (
                    <div className="aspect-video bg-black rounded-lg overflow-hidden opacity-50">
                      <img
                        src={imagePreview}
                        alt="Captured label"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}

                  <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <XCircle className="w-5 h-5 text-red-400" />
                      <span className="text-red-400 font-medium">Processing Failed</span>
                    </div>
                    <p className="text-slate-300 text-sm">{error || 'Unknown error occurred'}</p>
                  </div>

                  <button
                    onClick={handleReset}
                    className="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function ExtractedField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}:</span>
      <span className={value ? 'text-white' : 'text-slate-500'}>
        {value || 'Not detected'}
      </span>
    </div>
  );
}

function ComparisonField({ comparison }: { comparison: FieldComparison }) {
  const fieldLabels: Record<string, string> = {
    serialNumber: 'Serial Number',
    manufacturer: 'Manufacturer',
    model: 'Model',
  };

  return (
    <div className="flex items-center gap-2">
      {comparison.isMatch ? (
        <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
      )}
      <span className="text-slate-400 w-28">{fieldLabels[comparison.field] || comparison.field}:</span>
      <span className={comparison.isMatch ? 'text-white' : 'text-red-300'}>
        {comparison.found || 'Not detected'}
      </span>
      {!comparison.isMatch && comparison.expected && (
        <span className="text-slate-500 text-xs">(expected: {comparison.expected})</span>
      )}
    </div>
  );
}

export default LabelScanner;
