/**
 * Data Validation Phase Component
 *
 * Phase 3 of QA Wizard - Extracts and validates technical data from photos.
 */

import { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { QaWizardState, PowerMeterStatus, SerialValidationStatus } from '../../types/unified.types';

interface DataValidationPhaseProps {
  dropNumber: string;
  state: QaWizardState['dataValidation'];
  onemapOntSerial: string | null;
  onComplete: (data: QaWizardState['dataValidation']) => void;
  onBack: () => void;
}

interface ExtractDataResult {
  drNumber: string;
  extraction: {
    powerMeter: { success: boolean; value: number | null } | null;
    ontSerialStep6: { success: boolean; serial: string | null } | null;
    step9: {
      ontSerial: { success: boolean; serial: string | null };
      drNumber: { success: boolean; drNumber: string | null };
      greenLightsVisible: boolean;
    } | null;
  };
  validation: {
    powerMeter: { status: PowerMeterStatus; value: number | null; inRange: boolean };
    serialCrossReference: {
      status: SerialValidationStatus;
      onemapSerial: string | null;
      step6Serial: string | null;
      step9Serial: string | null;
      step9DrNumber: string | null;
      ontMatch: boolean;
      drMatch: boolean;
    };
  };
  summary: {
    powerMeterStatus: string;
    serialStatus: string;
    drNumberStatus: string;
    canProceed: boolean;
  };
}

export function DataValidationPhase({
  dropNumber,
  state,
  onemapOntSerial,
  onComplete,
  onBack,
}: DataValidationPhaseProps) {
  const [loading, setLoading] = useState(false);
  const [extractionDone, setExtractionDone] = useState(false);
  const [result, setResult] = useState<ExtractDataResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Manual override states
  const [powerMeterOverride, setPowerMeterOverride] = useState<string>('');
  const [useManualPower, setUseManualPower] = useState(false);

  // Auto-start extraction on mount
  useEffect(() => {
    if (!extractionDone && !loading) {
      runExtraction();
    }
  }, []);

  const runExtraction = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/activate/extract-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber, force: true }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data.data);
        setExtractionDone(true);
        log.info(`Extraction complete for ${dropNumber}`, {}, 'DataValidation');
      } else {
        throw new Error(data.error || 'Extraction failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Extraction failed';
      setError(message);
      log.error(`Extraction failed for ${dropNumber}: ${message}`, {}, 'DataValidation');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (!result) return;

    const validationData: QaWizardState['dataValidation'] = {
      completed: true,
      powerMeter: {
        status: result.validation.powerMeter.status,
        value: useManualPower ? parseFloat(powerMeterOverride) : result.validation.powerMeter.value,
        inRange: result.validation.powerMeter.inRange,
      },
      serialValidation: {
        status: result.validation.serialCrossReference.status,
        onemapSerial: result.validation.serialCrossReference.onemapSerial,
        step6Serial: result.validation.serialCrossReference.step6Serial,
        step9Serial: result.validation.serialCrossReference.step9Serial,
        step9DrNumber: result.validation.serialCrossReference.step9DrNumber,
        ontMatch: result.validation.serialCrossReference.ontMatch,
        drMatch: result.validation.serialCrossReference.drMatch,
      },
    };

    onComplete(validationData);
  };

  const getStatusIcon = (status: string): string => {
    if (status.includes('✅')) return '✅';
    if (status.includes('❌')) return '❌';
    if (status.includes('⏳')) return '⏳';
    return '🔧';
  };

  return (
    <div className="space-y-6">
      {/* Introduction */}
      {!extractionDone && !loading && (
        <div className="text-center py-8">
          <div className="text-4xl mb-4">🔍</div>
          <h4 className="text-lg font-medium text-foreground mb-2">
            Data Extraction
          </h4>
          <p className="text-muted-foreground mb-6">
            Extract and validate power meter reading and serial numbers from photos.
          </p>
          <Button
            variant="primary"
            onClick={() => { void runExtraction(); }}
          >
            Start Extraction
          </Button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-8">
          <LoadingSpinner className="mb-4" size="xl" label="" />
          <p className="text-muted-foreground">
            Extracting data from photos using VLM...
          </p>
          <p className="text-sm text-muted-foreground dark:text-gray-400 mt-2">
            This may take 30-60 seconds
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 mb-4">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <Button
            variant="link"
            onClick={() => { void runExtraction(); }}
            className="mt-2 text-sm text-red-600 dark:text-red-400"
          >
            Try Again
          </Button>
        </div>
      )}

      {/* Results */}
      {result && extractionDone && (
        <>
          {/* Power Meter Section */}
          <div className="bg-background/50 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <span>Power Meter Reading</span>
              <span>{getStatusIcon(result.summary.powerMeterStatus)}</span>
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">VLM Extracted:</span>
                <span className="font-mono text-foreground">
                  {result.validation.powerMeter.value !== null
                    ? `${result.validation.powerMeter.value} dBm`
                    : 'Not extracted'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Valid Range:</span>
                <span className="text-sm text-muted-foreground">
                  -18 to -24 dBm
                </span>
              </div>
              <p className="text-sm">{result.summary.powerMeterStatus}</p>

              {/* Manual override */}
              <div className="mt-3 pt-3 border-t border-border">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useManualPower}
                    onChange={(e) => setUseManualPower(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-muted-foreground">Override with manual value</span>
                </label>
                {useManualPower && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      value={powerMeterOverride}
                      onChange={(e) => setPowerMeterOverride(e.target.value)}
                      placeholder="-22.5"
                      step="0.1"
                      className="w-32 px-3 py-1 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
                    />
                    <span className="text-muted-foreground">dBm</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Serial Validation Section */}
          <div className="bg-background/50 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-3">
              ONT Serial Validation (3-Way Check)
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">OneMap Synced:</span>
                <span className="font-mono text-foreground">
                  {result.validation.serialCrossReference.onemapSerial || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">VLM Step 6 (Back):</span>
                <span className="font-mono text-foreground">
                  {result.validation.serialCrossReference.step6Serial || 'Not extracted'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">VLM Step 9 (Front):</span>
                <span className="font-mono text-foreground">
                  {result.validation.serialCrossReference.step9Serial || 'Not extracted'}
                </span>
              </div>
              <p className="text-sm mt-2">{result.summary.serialStatus}</p>
            </div>
          </div>

          {/* DR Number Validation */}
          <div className="bg-background/50 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-3">
              DR Number Validation (Step 9 Label)
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Expected:</span>
                <span className="font-mono text-foreground">{dropNumber}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">VLM Extracted:</span>
                <span className="font-mono text-foreground">
                  {result.validation.serialCrossReference.step9DrNumber || 'Not extracted'}
                </span>
              </div>
              <p className="text-sm mt-2">{result.summary.drNumberStatus}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-4">
            <Button
              variant="ghost"
              onClick={onBack}
            >
              ← Back
            </Button>
            <Button
              variant="primary"
              onClick={handleContinue}
            >
              Continue to Decision →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
