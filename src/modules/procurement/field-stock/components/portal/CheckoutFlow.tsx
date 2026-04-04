/**
 * CheckoutFlow Component
 * Issue Stock flow: Select technician → Scan items → Review → Submit
 */

import { useState, useId, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Trash2, Check, ArrowLeft } from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import type { StockLocation } from '../../types';
import type { ScannedSerial } from './types';
import { ScannerView } from './ScannerView';

// ---- Step definitions --------------------------------------------------

type CheckoutStep = 'technician' | 'scan' | 'review';

interface CheckoutFlowProps {
  /** Technician-type locations from useLocations */
  technicians: StockLocation[];
  techLoading: boolean;
  onBack: () => void;
  onDone: () => void;
}

// ---- Helpers -----------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1 mb-4">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i < current
              ? 'bg-blue-600'
              : i === current
              ? 'bg-blue-400'
              : 'bg-gray-200 dark:bg-gray-700'
          }`}
        />
      ))}
    </div>
  );
}

// ---- Main component ----------------------------------------------------

/** WORKING: Checkout flow with 3 steps */
export function CheckoutFlow({ technicians, techLoading, onBack, onDone }: CheckoutFlowProps) {
  const scannerId = useId();
  const elementId = `checkout-scanner-${scannerId.replace(/:/g, '')}`;

  const [step, setStep] = useState<CheckoutStep>('technician');
  const [selectedTechId, setSelectedTechId] = useState('');
  const [scannedItems, setScannedItems] = useState<ScannedSerial[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const scannedSet = new Set(scannedItems.map((i) => i.serial));

  const handleCode = useCallback((code: string) => {
    setScannedItems((prev) => [...prev, { serial: code }]);
    toast.success(`Added: ${code}`, { duration: 1500 });
  }, []);

  const removeItem = (serial: string) => {
    setScannedItems((prev) => prev.filter((i) => i.serial !== serial));
  };

  const handleSubmit = async () => {
    if (!selectedTechId || scannedItems.length === 0) return;

    const tech = technicians.find((t) => t.id === selectedTechId);
    if (!tech) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/procurement/field-stock/pickings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickingType: 'issue',
          destinationLocationId: selectedTechId,
          technicianName: tech.assignedToName || tech.name,
          serials: scannedItems.map((i) => i.serial),
          notes: `Portal issue — ${scannedItems.length} item(s)`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to issue stock');
      }

      toast.success(`Issued ${scannedItems.length} item(s) to ${tech.name}`);
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error('Checkout submit failed', { error: err }, 'CheckoutFlow');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Render -----------------------------------------------------------

  const stepIndex = ['technician', 'scan', 'review'].indexOf(step);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={stepIndex === 0 ? onBack : () => setStep(['technician', 'scan', 'review'][stepIndex - 1] as CheckoutStep)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Issue Stock</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Step {stepIndex + 1} of 3</p>
        </div>
      </div>

      <StepIndicator current={stepIndex} total={3} />

      {/* Step 1: Select technician */}
      {step === 'technician' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Select the technician to issue stock to:
          </p>

          {techLoading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" label="" className="text-blue-600" />
            </div>
          ) : (
            <div className="space-y-2">
              {technicians.map((tech) => (
                <button
                  key={tech.id}
                  onClick={() => setSelectedTechId(tech.id)}
                  className={`w-full min-h-[56px] flex items-center gap-4 px-4 py-3 rounded-xl border-2 transition-colors text-left ${
                    selectedTechId === tech.id
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-700 dark:text-blue-300 font-bold text-sm">
                      {(tech.assignedToName || tech.name).slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {tech.assignedToName || tech.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{tech.code}</p>
                  </div>
                  {selectedTechId === tech.id && (
                    <Check className="w-5 h-5 text-blue-600 ml-auto" />
                  )}
                </button>
              ))}

              {technicians.length === 0 && (
                <p className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No technician locations configured.
                </p>
              )}
            </div>
          )}

          <button
            onClick={() => setStep('scan')}
            disabled={!selectedTechId}
            className="w-full min-h-[56px] bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
          >
            Next: Scan Items
          </button>
        </div>
      )}

      {/* Step 2: Scan */}
      {step === 'scan' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Scan or enter serial numbers to add to the issue:
          </p>

          <ScannerView
            elementId={elementId}
            onCode={handleCode}
            manualPlaceholder="Enter serial number…"
            scannedSet={scannedSet}
          />

          {/* Running list */}
          {scannedItems.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Scanned ({scannedItems.length})
              </p>
              {scannedItems.slice(-5).map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 py-1">
                  <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="flex-1 text-sm font-mono text-gray-900 dark:text-white truncate">
                    {item.serial}
                  </span>
                </div>
              ))}
              {scannedItems.length > 5 && (
                <p className="text-xs text-gray-400">
                  …and {scannedItems.length - 5} more
                </p>
              )}
            </div>
          )}

          <button
            onClick={() => setStep('review')}
            disabled={scannedItems.length === 0}
            className="w-full min-h-[56px] bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
          >
            Review ({scannedItems.length} items)
          </button>
        </div>
      )}

      {/* Step 3: Review & Submit */}
      {step === 'review' && (
        <div className="space-y-4">
          {/* Summary card */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Issuing to</p>
            <p className="font-bold text-gray-900 dark:text-white">
              {technicians.find((t) => t.id === selectedTechId)?.assignedToName ||
               technicians.find((t) => t.id === selectedTechId)?.name}
            </p>
          </div>

          {/* Item list */}
          <div className="bg-white dark:bg-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
            {scannedItems.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 px-4 py-3">
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
                <InlineSpinner size="md" />
                Submitting…
              </>
            ) : (
              `Confirm Issue (${scannedItems.length} items)`
            )}
          </button>
        </div>
      )}
    </div>
  );
}
