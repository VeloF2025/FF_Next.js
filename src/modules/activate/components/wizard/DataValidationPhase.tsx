/**
 * Data Validation Phase Component
 *
 * Phase 3 of QA Wizard - Extracts and validates technical data from photos.
 */

import React, { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
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
        log.info('DataValidation', `Extraction complete for ${dropNumber}`);
      } else {
        throw new Error(data.error || 'Extraction failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Extraction failed';
      setError(message);
      log.error('DataValidation', `Extraction failed for ${dropNumber}: ${message}`);
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
          <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Data Extraction
          </h4>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Extract and validate power meter reading and serial numbers from photos.
          </p>
          <button
            onClick={runExtraction}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Start Extraction
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">
            Extracting data from photos using VLM...
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
            This may take 30-60 seconds
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 mb-4">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={runExtraction}
            className="mt-2 text-sm text-red-600 dark:text-red-400 underline"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Results */}
      {result && extractionDone && (
        <>
          {/* Power Meter Section */}
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <span>Power Meter Reading</span>
              <span>{getStatusIcon(result.summary.powerMeterStatus)}</span>
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-gray-400">VLM Extracted:</span>
                <span className="font-mono text-gray-900 dark:text-white">
                  {result.validation.powerMeter.value !== null
                    ? `${result.validation.powerMeter.value} dBm`
                    : 'Not extracted'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-gray-400">Valid Range:</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  -18 to -24 dBm
                </span>
              </div>
              <p className="text-sm">{result.summary.powerMeterStatus}</p>

              {/* Manual override */}
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useManualPower}
                    onChange={(e) => setUseManualPower(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-gray-600 dark:text-gray-400">Override with manual value</span>
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
                    <span className="text-gray-500">dBm</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Serial Validation Section */}
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 dark:text-white mb-3">
              ONT Serial Validation (3-Way Check)
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-gray-400">OneMap Synced:</span>
                <span className="font-mono text-gray-900 dark:text-white">
                  {result.validation.serialCrossReference.onemapSerial || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-gray-400">VLM Step 6 (Back):</span>
                <span className="font-mono text-gray-900 dark:text-white">
                  {result.validation.serialCrossReference.step6Serial || 'Not extracted'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-gray-400">VLM Step 9 (Front):</span>
                <span className="font-mono text-gray-900 dark:text-white">
                  {result.validation.serialCrossReference.step9Serial || 'Not extracted'}
                </span>
              </div>
              <p className="text-sm mt-2">{result.summary.serialStatus}</p>
            </div>
          </div>

          {/* DR Number Validation */}
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 dark:text-white mb-3">
              DR Number Validation (Step 9 Label)
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-gray-400">Expected:</span>
                <span className="font-mono text-gray-900 dark:text-white">{dropNumber}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-gray-400">VLM Extracted:</span>
                <span className="font-mono text-gray-900 dark:text-white">
                  {result.validation.serialCrossReference.step9DrNumber || 'Not extracted'}
                </span>
              </div>
              <p className="text-sm mt-2">{result.summary.drNumberStatus}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-4">
            <button
              onClick={onBack}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← Back
            </button>
            <button
              onClick={handleContinue}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Continue to Decision →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
