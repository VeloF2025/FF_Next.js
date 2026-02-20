/**
 * ConsumeFlow Component
 * Link a serial number to a DR number (Scan & Install flow)
 * Steps: Enter DR → Scan serial → Auto-lookup → Submit
 */

import { useState, useId, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Loader2, ArrowLeft, Check, AlertCircle } from 'lucide-react';
import { log } from '@/lib/logger';
import type { SerialLookupResult } from './types';
import { ScannerView } from './ScannerView';

interface ConsumeFlowProps {
  /** Pre-populated DR number (e.g. from quick-scan FAB) */
  initialDrNumber?: string;
  /** Pre-populated serial (e.g. from quick-scan FAB) */
  initialSerial?: string;
  onBack: () => void;
  onDone: () => void;
}

type ConsumeStep = 'dr' | 'scan' | 'confirm';

/** WORKING: Consume/link-serial-to-DR flow */
export function ConsumeFlow({ initialDrNumber, initialSerial, onBack, onDone }: ConsumeFlowProps) {
  const scannerId = useId();
  const elementId = `consume-scanner-${scannerId.replace(/:/g, '')}`;

  const [step, setStep] = useState<ConsumeStep>(initialSerial ? 'confirm' : initialDrNumber ? 'scan' : 'dr');
  const [drNumber, setDrNumber] = useState(initialDrNumber ?? '');
  const [_serial, setSerial] = useState(initialSerial ?? '');
  const [lookupResult, setLookupResult] = useState<SerialLookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const lookupSerial = useCallback(async (code: string) => {
    setSerial(code);
    setLookupLoading(true);
    setLookupResult(null);

    try {
      const response = await fetch(
        `/api/procurement/field-stock/serials?search=${encodeURIComponent(code)}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Lookup failed');
      }

      // API returns paginated list — check first item
      const items = data.data?.items ?? data.data ?? [];
      const match = Array.isArray(items) ? items[0] : null;

      if (match) {
        const result: SerialLookupResult = {
          found: true,
          serialId: match.id,
          serialNumber: match.serialNumber,
          stockItemId: match.stockItemId,
          itemName: match.itemName ?? match.stockItem?.name,
          itemCode: match.itemCode ?? match.stockItem?.itemCode,
          status: match.status,
          locationName: match.locationName ?? match.currentLocation?.name,
        };
        setLookupResult(result);
        setStep('confirm');
      } else {
        setLookupResult({ found: false, error: `No serial found: "${code}"` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lookup error';
      log.error('Serial lookup failed', { error: err }, 'ConsumeFlow');
      setLookupResult({ found: false, error: msg });
    } finally {
      setLookupLoading(false);
    }
  }, []);

  const handleCode = useCallback((code: string) => {
    lookupSerial(code);
  }, [lookupSerial]);

  const handleSubmit = async () => {
    if (!lookupResult?.found || !lookupResult.stockItemId) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/procurement/field-stock/consumptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: 'drop',
          dropNumber: drNumber.trim(),
          stockItemId: lookupResult.stockItemId,
          quantity: 1,
          serialId: lookupResult.serialId,
          serialNumber: lookupResult.serialNumber,
          consumedFromLocationId: null,
          notes: `Portal scan: DR ${drNumber.trim()}`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to record consumption');
      }

      toast.success(`Linked ${lookupResult.serialNumber} to DR ${drNumber.trim()}`);
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error('Consume submit failed', { error: err }, 'ConsumeFlow');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = ['dr', 'scan', 'confirm'].indexOf(step);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={stepIndex === 0 ? onBack : () => {
            const steps: ConsumeStep[] = ['dr', 'scan', 'confirm'];
            setStep(steps[stepIndex - 1] as ConsumeStep);
          }}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Scan & Install</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Link serial to DR</p>
        </div>
      </div>

      {/* Step 1: DR number */}
      {step === 'dr' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Enter the DR number this installation is for:
          </p>
          <input
            type="text"
            value={drNumber}
            onChange={(e) => setDrNumber(e.target.value)}
            placeholder="DR-12345 or 12345"
            className="w-full min-h-[56px] px-4 text-base border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            autoFocus
          />
          <button
            onClick={() => setStep('scan')}
            disabled={!drNumber.trim()}
            className="w-full min-h-[56px] bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
          >
            Next: Scan Serial
          </button>
        </div>
      )}

      {/* Step 2: Scan serial */}
      {step === 'scan' && (
        <div className="space-y-4">
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-2">
            <p className="text-xs text-green-700 dark:text-green-300">DR: <strong>{drNumber}</strong></p>
          </div>

          {lookupLoading ? (
            <div className="flex items-center justify-center py-12 bg-white dark:bg-gray-800 rounded-xl">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-green-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Looking up serial…</p>
              </div>
            </div>
          ) : (
            <ScannerView
              elementId={elementId}
              onCode={handleCode}
              manualPlaceholder="Enter serial number…"
            />
          )}

          {lookupResult && !lookupResult.found && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">{lookupResult.error}</p>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 'confirm' && lookupResult?.found && (
        <div className="space-y-4">
          {/* DR badge */}
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-2">
            <p className="text-xs text-green-700 dark:text-green-300">DR: <strong>{drNumber}</strong></p>
          </div>

          {/* Serial details card */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Check className="w-5 h-5 text-green-500" />
              <span className="font-semibold text-gray-900 dark:text-white">Serial Found</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <span className="text-gray-500 dark:text-gray-400">Serial</span>
              <span className="font-mono text-gray-900 dark:text-white">{lookupResult.serialNumber}</span>
              {lookupResult.itemName && (
                <>
                  <span className="text-gray-500 dark:text-gray-400">Item</span>
                  <span className="text-gray-900 dark:text-white">{lookupResult.itemName}</span>
                </>
              )}
              {lookupResult.itemCode && (
                <>
                  <span className="text-gray-500 dark:text-gray-400">Code</span>
                  <span className="text-gray-900 dark:text-white">{lookupResult.itemCode}</span>
                </>
              )}
              {lookupResult.status && (
                <>
                  <span className="text-gray-500 dark:text-gray-400">Status</span>
                  <span className="capitalize text-gray-900 dark:text-white">{lookupResult.status}</span>
                </>
              )}
              {lookupResult.locationName && (
                <>
                  <span className="text-gray-500 dark:text-gray-400">Location</span>
                  <span className="text-gray-900 dark:text-white">{lookupResult.locationName}</span>
                </>
              )}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full min-h-[56px] bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Recording…
              </>
            ) : (
              'Record Installation'
            )}
          </button>

          {/* Scan another option */}
          <button
            onClick={() => {
              setSerial('');
              setLookupResult(null);
              setStep('scan');
            }}
            className="w-full min-h-[48px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm transition-colors"
          >
            Scan a different serial
          </button>
        </div>
      )}
    </div>
  );
}
