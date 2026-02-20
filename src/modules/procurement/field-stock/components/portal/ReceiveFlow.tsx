/**
 * ReceiveFlow Component
 * Receive Delivery (GRN) flow: Enter reference → Batch scan → Review → Submit
 */

import { useState, useId, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Trash2, ArrowLeft } from 'lucide-react';
import { log } from '@/lib/logger';
import type { ScannedSerial } from './types';
import { ScannerView } from './ScannerView';

interface ReceiveFlowProps {
  onBack: () => void;
  onDone: () => void;
}

type ReceiveStep = 'reference' | 'scan' | 'review';

/** WORKING: Receive delivery (GRN) flow with batch scanning */
export function ReceiveFlow({ onBack, onDone }: ReceiveFlowProps) {
  const scannerId = useId();
  const elementId = `receive-scanner-${scannerId.replace(/:/g, '')}`;

  const [step, setStep] = useState<ReceiveStep>('reference');
  const [grnRef, setGrnRef] = useState('');
  const [scannedItems, setScannedItems] = useState<ScannedSerial[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const scannedSet = new Set(scannedItems.map((i) => i.serial));

  const handleCode = useCallback((code: string) => {
    setScannedItems((prev) => [...prev, { serial: code }]);
    if (navigator.vibrate) navigator.vibrate(60);
  }, []);

  const removeItem = (serial: string) => {
    setScannedItems((prev) => prev.filter((i) => i.serial !== serial));
  };

  const handleSubmit = async () => {
    if (!grnRef.trim() || scannedItems.length === 0) return;

    setSubmitting(true);
    try {
      // Batch register each serial via the serials endpoint
      const response = await fetch('/api/procurement/field-stock/serials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch: true,
          receivedReference: grnRef.trim(),
          serials: scannedItems.map((item) => ({
            serialNumber: item.serial,
            receivedDate: new Date().toISOString(),
            receivedReference: grnRef.trim(),
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to receive delivery');
      }

      toast.success(`GRN ${grnRef.trim()}: ${scannedItems.length} serial(s) received`);
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error('Receive submit failed', { error: err }, 'ReceiveFlow');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = ['reference', 'scan', 'review'].indexOf(step);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={stepIndex === 0 ? onBack : () => setStep(['reference', 'scan', 'review'][stepIndex - 1] as ReceiveStep)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Receive Delivery</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">GRN — Step {stepIndex + 1} of 3</p>
        </div>
      </div>

      {/* Step 1: Reference */}
      {step === 'reference' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Enter the GRN or delivery reference number:
          </p>
          <input
            type="text"
            value={grnRef}
            onChange={(e) => setGrnRef(e.target.value)}
            placeholder="GRN-2026-001 or PO-12345"
            className="w-full min-h-[56px] px-4 text-base border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            autoFocus
          />
          <button
            onClick={() => setStep('scan')}
            disabled={!grnRef.trim()}
            className="w-full min-h-[56px] bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
          >
            Next: Batch Scan
          </button>
        </div>
      )}

      {/* Step 2: Continuous scan */}
      {step === 'scan' && (
        <div className="space-y-4">
          {/* GRN context */}
          <div className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl px-4 py-2">
            <p className="text-xs text-purple-700 dark:text-purple-300">
              GRN: <strong>{grnRef}</strong>
            </p>
            <span className="text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 rounded-full">
              {scannedItems.length} scanned
            </span>
          </div>

          <ScannerView
            elementId={elementId}
            onCode={handleCode}
            manualPlaceholder="Enter serial number…"
            scannedSet={scannedSet}
          />

          {/* Scrollable running list */}
          {scannedItems.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
              {[...scannedItems].reverse().map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 px-4 py-2">
                  <span className="text-xs text-gray-400 w-6 text-right flex-shrink-0">
                    {scannedItems.length - idx}
                  </span>
                  <span className="flex-1 text-sm font-mono text-gray-900 dark:text-white truncate">
                    {item.serial}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setStep('review')}
            disabled={scannedItems.length === 0}
            className="w-full min-h-[56px] bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
          >
            Review ({scannedItems.length} items)
          </button>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl px-4 py-2">
            <p className="text-xs text-purple-700 dark:text-purple-300">
              GRN: <strong>{grnRef}</strong> — {scannedItems.length} serials
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {scannedItems.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-xs text-gray-400 w-6 text-right flex-shrink-0">{idx + 1}</span>
                <span className="flex-1 text-sm font-mono text-gray-900 dark:text-white truncate">
                  {item.serial}
                </span>
                <button
                  onClick={() => removeItem(item.serial)}
                  className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting || scannedItems.length === 0}
            className="w-full min-h-[56px] bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Receiving…
              </>
            ) : (
              `Confirm Receipt (${scannedItems.length} items)`
            )}
          </button>
        </div>
      )}
    </div>
  );
}
