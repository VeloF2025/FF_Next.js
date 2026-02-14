/**
 * CheckInItemRow Component
 * Single checklist item with pass/fail toggle
 */

import React, { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import type { CheckItem, CreateCheckResponseInput } from '../../types/check-in.types';

interface CheckInItemRowProps {
  item: CheckItem;
  response?: CreateCheckResponseInput;
  onResponse: (itemId: string, isPassed: boolean, notes?: string) => void;
}

export function CheckInItemRow({ item, response, onResponse }: CheckInItemRowProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(response?.notes || '');

  const isPassed = response?.isPassed;
  const hasResponse = response !== undefined;

  const handlePassClick = () => {
    onResponse(item.id, true, notes || undefined);
  };

  const handleFailClick = () => {
    setShowNotes(true);
    onResponse(item.id, false, notes || undefined);
  };

  const handleNotesChange = (value: string) => {
    setNotes(value);
    if (hasResponse) {
      onResponse(item.id, response.isPassed, value || undefined);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-white dark:bg-gray-800">
      {/* Main row */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Item info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 dark:text-white">
                {item.name}
              </span>
              {item.isCritical && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Critical
                </span>
              )}
            </div>
            {item.description && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {item.description}
              </p>
            )}
          </div>

          {/* Pass/Fail buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handlePassClick}
              className={`p-3 rounded-lg transition-all ${
                isPassed === true
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-green-100 hover:text-green-600'
              }`}
            >
              <CheckCircle className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={handleFailClick}
              className={`p-3 rounded-lg transition-all ${
                isPassed === false
                  ? item.isCritical
                    ? 'bg-red-500 text-white'
                    : 'bg-amber-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-red-100 hover:text-red-600'
              }`}
            >
              <XCircle className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Notes toggle for failed items */}
        {isPassed === false && (
          <button
            type="button"
            onClick={() => setShowNotes(!showNotes)}
            className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-400"
          >
            {showNotes ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
            {showNotes ? 'Hide notes' : 'Add notes'}
          </button>
        )}
      </div>

      {/* Notes section */}
      {showNotes && isPassed === false && (
        <div className="px-4 pb-4">
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Describe the issue..."
            className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 dark:border-gray-700 focus:ring-2 focus:ring-blue-500"
            rows={2}
          />
        </div>
      )}

      {/* Status indicator bar */}
      <div
        className={`h-1 ${
          !hasResponse
            ? 'bg-gray-200 dark:bg-gray-700'
            : isPassed
              ? 'bg-green-500'
              : item.isCritical
                ? 'bg-red-500'
                : 'bg-amber-500'
        }`}
      />
    </div>
  );
}
