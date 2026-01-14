/**
 * VlmResultCard Component
 * Displays VLM extraction results with manual override option
 */

import React, { useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Edit3, RefreshCw } from 'lucide-react';
import type { VlmAnalysisType, CheckPhotoType } from '../../types/check-in.types';

interface VlmResult {
  photoType: CheckPhotoType;
  analysisType: VlmAnalysisType;
  extractedValue: string | null;
  extractedNumeric: number | null;
  confidence: number;
  plateMatches?: boolean;
  isProcessing: boolean;
  error?: string;
}

interface VlmResultCardProps {
  title: string;
  icon: React.ReactNode;
  vlmResult: VlmResult;
  currentValue: string;
  unit: string;
  onOverride: (value: string) => void;
}

export function VlmResultCard({
  title,
  icon,
  vlmResult,
  currentValue,
  unit,
  onOverride,
}: VlmResultCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentValue);

  const confidence = Math.round(vlmResult.confidence * 100);
  const isHighConfidence = confidence >= 80;
  const isMediumConfidence = confidence >= 50 && confidence < 80;

  const handleSave = () => {
    onOverride(editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(currentValue);
    setIsEditing(false);
  };

  // Processing state
  if (vlmResult.isProcessing) {
    return (
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg text-blue-600 dark:text-blue-400">
            {icon}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">{title}</p>
            <div className="flex items-center gap-2 mt-1">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <span className="text-sm text-blue-600 dark:text-blue-400">
                Analyzing photo...
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (vlmResult.error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 dark:bg-red-800 rounded-lg text-red-600 dark:text-red-400">
            {icon}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">{title}</p>
            <div className="flex items-center gap-2 mt-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-red-600 dark:text-red-400">
                Could not read - enter manually
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="p-2 text-red-600 hover:bg-red-100 dark:hover:bg-red-800 rounded-lg"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>
        {isEditing && (
          <div className="mt-3 flex gap-2">
            <input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 dark:border-gray-700"
              placeholder={`Enter ${title.toLowerCase()}`}
              autoFocus
            />
            <button
              type="button"
              onClick={handleSave}
              className="px-3 py-2 bg-red-500 text-white rounded-lg text-sm font-medium"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  // Success state - show extracted value
  const bgColor = isHighConfidence
    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    : isMediumConfidence
      ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
      : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800';

  const textColor = isHighConfidence
    ? 'text-green-700 dark:text-green-300'
    : isMediumConfidence
      ? 'text-yellow-700 dark:text-yellow-300'
      : 'text-orange-700 dark:text-orange-300';

  const iconBgColor = isHighConfidence
    ? 'bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-400'
    : isMediumConfidence
      ? 'bg-yellow-100 dark:bg-yellow-800 text-yellow-600 dark:text-yellow-400'
      : 'bg-orange-100 dark:bg-orange-800 text-orange-600 dark:text-orange-400';

  return (
    <div className={`p-4 border rounded-lg ${bgColor}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${iconBgColor}`}>
          {icon}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-medium ${textColor}`}>{title}</p>
          {isEditing ? (
            <div className="mt-2 flex gap-2">
              <input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 dark:border-gray-700"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSave}
                className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-2 border rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                {currentValue ? Number(currentValue).toLocaleString() : '--'}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">{unit}</span>
              <div className="flex items-center gap-1 ml-2">
                <CheckCircle2 className={`w-4 h-4 ${
                  isHighConfidence
                    ? 'text-green-500'
                    : isMediumConfidence
                      ? 'text-yellow-500'
                      : 'text-orange-500'
                }`} />
                <span className={`text-xs ${
                  isHighConfidence
                    ? 'text-green-600 dark:text-green-400'
                    : isMediumConfidence
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-orange-600 dark:text-orange-400'
                }`}>
                  {confidence}% confidence
                </span>
              </div>
            </div>
          )}
        </div>
        {!isEditing && (
          <button
            type="button"
            onClick={() => {
              setEditValue(currentValue);
              setIsEditing(true);
            }}
            className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            title="Edit value"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Low confidence warning */}
      {!isHighConfidence && !isEditing && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {isMediumConfidence
            ? 'Please verify this reading is correct'
            : 'Low confidence - please check and correct if needed'
          }
        </p>
      )}
    </div>
  );
}
