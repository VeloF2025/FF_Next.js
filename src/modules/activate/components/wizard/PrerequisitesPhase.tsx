/**
 * Prerequisites Phase Component
 *
 * Phase 1 of QA Wizard - Validates prerequisites before detailed review.
 */

import React from 'react';
import type { QaWizardState } from '../../types/unified.types';

interface PrerequisitesPhaseProps {
  dropNumber: string;
  state: QaWizardState['prerequisites'];
  onComplete: (passed: boolean) => void;
  onRefresh: () => void;
}

export function PrerequisitesPhase({
  dropNumber,
  state,
  onComplete,
  onRefresh,
}: PrerequisitesPhaseProps) {
  const renderCheckItem = (
    label: string,
    passed: boolean,
    detail?: string
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <div className="flex items-center gap-3">
        <span className={`text-xl ${passed ? 'text-green-500' : 'text-red-500'}`}>
          {passed ? '✅' : '❌'}
        </span>
        <span className="text-gray-900 dark:text-white">{label}</span>
      </div>
      {detail && (
        <span className="text-sm text-gray-500 dark:text-gray-400">{detail}</span>
      )}
    </div>
  );

  const allPassed = state.passed && state.photosAvailable;

  return (
    <div className="space-y-4">
      {/* Status message */}
      <div
        className={`p-4 rounded-lg ${
          allPassed
            ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
            : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
        }`}
      >
        <p className={allPassed ? 'text-green-700 dark:text-green-300' : 'text-yellow-700 dark:text-yellow-300'}>
          {allPassed
            ? 'All prerequisites met. Ready to proceed.'
            : 'Some prerequisites need attention before proceeding.'}
        </p>
      </div>

      {/* Prerequisites checklist */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
        {renderCheckItem(
          'Photos Available',
          state.photosAvailable,
          state.photoCount > 0 ? `${state.photoCount} photos found` : 'No photos synced'
        )}
        {renderCheckItem(
          'ONT Serial (from OneMap)',
          state.ontSerialPresent,
          state.ontSerial || 'Not synced'
        )}
        {renderCheckItem(
          'UPS Serial (from OneMap)',
          state.upsSerialPresent,
          state.upsSerial || 'Not synced'
        )}
      </div>

      {/* Failure reasons */}
      {state.failures.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
          <h4 className="font-medium text-red-700 dark:text-red-300 mb-2">
            Issues Found:
          </h4>
          <ul className="list-disc list-inside text-sm text-red-600 dark:text-red-400 space-y-1">
            {state.failures.map((failure, idx) => (
              <li key={idx}>{failure}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-4">
        <button
          onClick={onRefresh}
          className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          Refresh
        </button>
        <button
          onClick={() => onComplete(allPassed)}
          disabled={!allPassed}
          className={`px-6 py-2 rounded-lg font-medium ${
            allPassed
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
          }`}
        >
          Continue to Photo Review
        </button>
      </div>
    </div>
  );
}
