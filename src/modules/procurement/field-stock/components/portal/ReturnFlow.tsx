/**
 * ReturnFlow Component
 * Process Return flow: Select technician → Scan items with condition → Submit
 */

import { useState, useId, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Trash2, ArrowLeft, Check } from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import type { StockLocation, SerialCondition } from '../../types';
import type { ReturnItem } from './types';
import { ScannerView } from './ScannerView';

interface ReturnFlowProps {
  technicians: StockLocation[];
  techLoading: boolean;
  onBack: () => void;
  onDone: () => void;
}

type ReturnCondition = 'good' | 'fair' | 'damaged';

const CONDITION_LABELS: Record<ReturnCondition, string> = {
  good: 'Good',
  fair: 'Fair',
  damaged: 'Damaged',
};

const CONDITION_COLORS: Record<ReturnCondition, string> = {
  good: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  fair: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  damaged: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

type ReturnStep = 'technician' | 'scan' | 'review';

/** WORKING: Return flow */
export function ReturnFlow({ technicians, techLoading, onBack, onDone }: ReturnFlowProps) {
  const scannerId = useId();
  const elementId = `return-scanner-${scannerId.replace(/:/g, '')}`;

  const [step, setStep] = useState<ReturnStep>('technician');
  const [selectedTechId, setSelectedTechId] = useState('');
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const scannedSet = new Set(returnItems.map((i) => i.serial));

  const handleCode = useCallback((code: string) => {
    setReturnItems((prev) => [...prev, { serial: code, condition: 'good' }]);
    toast.success(`Added: ${code}`, { duration: 1500 });
  }, []);

  const updateCondition = (serial: string, condition: ReturnCondition) => {
    setReturnItems((prev) =>
      prev.map((item) => (item.serial === serial ? { ...item, condition } : item))
    );
  };

  const removeItem = (serial: string) => {
    setReturnItems((prev) => prev.filter((i) => i.serial !== serial));
  };

  const mapCondition = (c: ReturnCondition): SerialCondition =>
    c === 'good' ? 'good' : c === 'fair' ? 'fair' : 'damaged';

  const handleSubmit = async () => {
    if (!selectedTechId || returnItems.length === 0) return;

    const tech = technicians.find((t) => t.id === selectedTechId);
    if (!tech) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/procurement/field-stock/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnedById: selectedTechId,
          returnedByName: tech.assignedToName || tech.name,
          returnToLocationId: null,
          notes: `Portal return — ${returnItems.length} item(s)`,
          lines: returnItems.map((item) => ({
            serialNumber: item.serial,
            quantity: 1,
            condition: mapCondition(item.condition),
            returnReason: 'unused',
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to process return');
      }

      toast.success(`Return processed: ${returnItems.length} item(s)`);
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error('Return submit failed', { error: err }, 'ReturnFlow');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = ['technician', 'scan', 'review'].indexOf(step);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={stepIndex === 0 ? onBack : () => setStep(['technician', 'scan', 'review'][stepIndex - 1] as ReturnStep)}
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Process Return</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Step {stepIndex + 1} of 3</p>
        </div>
      </div>

      {/* Step 1: Technician */}
      {step === 'technician' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Select the technician returning stock:
          </p>
          {techLoading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" label="" className="text-orange-600" />
            </div>
          ) : (
            <div className="space-y-2">
              {technicians.map((tech) => (
                <button
                  key={tech.id}
                  onClick={() => setSelectedTechId(tech.id)}
                  className={`w-full min-h-[56px] flex items-center gap-4 px-4 py-3 rounded-xl border-2 transition-colors text-left ${
                    selectedTechId === tech.id
                      ? 'border-orange-600 bg-orange-50 dark:bg-orange-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-orange-700 dark:text-orange-300 font-bold text-sm">
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
                    <Check className="w-5 h-5 text-orange-600 ml-auto" />
                  )}
                </button>
              ))}
            </div>
          )}
          <Button
            onClick={() => setStep('scan')}
            disabled={!selectedTechId}
            className="w-full min-h-[56px]"
          >
            Next: Scan Items
          </Button>
        </div>
      )}

      {/* Step 2: Scan */}
      {step === 'scan' && (
        <div className="space-y-4">
          <ScannerView
            elementId={elementId}
            onCode={handleCode}
            manualPlaceholder="Enter serial number…"
            scannedSet={scannedSet}
          />

          {returnItems.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Scanned ({returnItems.length})
              </p>
              {returnItems.slice(-4).map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 py-1">
                  <span className="flex-1 text-sm font-mono truncate">{item.serial}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${CONDITION_COLORS[item.condition]}`}>
                    {CONDITION_LABELS[item.condition]}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Button
            onClick={() => setStep('review')}
            disabled={returnItems.length === 0}
            className="w-full min-h-[56px]"
          >
            Review ({returnItems.length} items)
          </Button>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
            {returnItems.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 px-4 py-3">
                <span className="flex-1 text-sm font-mono text-gray-900 dark:text-white truncate">
                  {item.serial}
                </span>
                <select
                  value={item.condition}
                  onChange={(e) => updateCondition(item.serial, e.target.value as ReturnCondition)}
                  className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800"
                >
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="damaged">Damaged</option>
                </select>
                <Button variant="ghost" size="icon" onClick={() => removeItem(item.serial)} aria-label="Remove item">
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full min-h-[56px]"
          >
            {submitting ? (
              <>
                <InlineSpinner size="md" />
                Processing…
              </>
            ) : (
              `Confirm Return (${returnItems.length} items)`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
