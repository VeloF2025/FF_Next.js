/**
 * ManualDREntry Component
 *
 * Allows manual entry of DR numbers when WhatsApp bridge is down.
 * Users can paste drop numbers or upload a text file.
 */

'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

interface ManualDREntryProps {
  onDRsAdded?: (count: number) => void;
}

interface PreviousSubmission {
  submission_number: number;
  snapshot_at: string;
  photo_count: number;
  feedback_sent: boolean;
}

interface ProcessingResult {
  dropNumber: string;
  status: 'success' | 'error' | 'resubmission';
  message: string;
  isResubmission?: boolean;
  submissionCount?: number;
  previousSubmission?: PreviousSubmission | null;
}

export function ManualDREntry({ onDRsAdded }: ManualDREntryProps) {
  const [input, setInput] = useState('');
  const [project, setProject] = useState('');
  const [submittedDate, setSubmittedDate] = useState(() => {
    // Default to today in YYYY-MM-DD format
    return new Date().toISOString().split('T')[0];
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ProcessingResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Extract DR numbers from text (supports various formats)
  function extractDRNumbers(text: string): string[] {
    const pattern = /DR\d{6,8}/gi;
    const matches = text.match(pattern) || [];
    // Deduplicate and uppercase
    return [...new Set(matches.map((m) => m.toUpperCase()))];
  }

  async function handleSubmit() {
    setError(null);
    setResults([]);

    const drNumbers = extractDRNumbers(input);

    if (drNumbers.length === 0) {
      setError('No valid DR numbers found. Format: DR1234567');
      return;
    }

    if (!project.trim()) {
      setError('Please select or enter a project name');
      return;
    }

    setIsProcessing(true);
    const newResults: ProcessingResult[] = [];

    for (const dropNumber of drNumbers) {
      try {
        const response = await fetch('/api/activate/process-new-dr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dropNumber,
            project: project.trim(),
            submittedDate,
          }),
        });

        const data = await response.json();

        if (data.success) {
          const responseData = data.data;
          const isResubmission = responseData.isResubmission || false;
          const prevSub = responseData.previousSubmission;

          log.debug('ManualDREntry', {
            action: 'processDR',
            dropNumber,
            isResubmission,
            submissionCount: responseData.submissionCount,
            responseData
          });

          let message = `${responseData.photosDownloaded} photos, ${responseData.categorizationStatus}`;
          if (isResubmission && prevSub) {
            message += ` (Resubmission #${responseData.submissionCount})`;
            if (prevSub.feedback_sent) {
              message += ' - Previous had feedback';
            }
          }

          newResults.push({
            dropNumber,
            status: isResubmission ? 'resubmission' : 'success',
            message,
            isResubmission,
            submissionCount: responseData.submissionCount,
            previousSubmission: prevSub,
          });
        } else {
          newResults.push({
            dropNumber,
            status: 'error',
            message: data.message || 'Processing failed',
          });
        }
      } catch (err) {
        newResults.push({
          dropNumber,
          status: 'error',
          message: err instanceof Error ? err.message : 'Network error',
        });
      }

      // Update results progressively
      setResults([...newResults]);
    }

    setIsProcessing(false);
    setInput('');

    const successCount = newResults.filter((r) => r.status === 'success').length;
    const resubmissionCount = newResults.filter((r) => r.status === 'resubmission').length;
    const errorCount = newResults.filter((r) => r.status === 'error').length;

    // Show toast notification based on results
    if (errorCount === newResults.length) {
      toast.error(`Failed to process ${errorCount} DR${errorCount > 1 ? 's' : ''}`);
    } else if (errorCount > 0) {
      toast(`Processed ${successCount + resubmissionCount} DR${successCount + resubmissionCount > 1 ? 's' : ''}, ${errorCount} failed`, {
        icon: '⚠️',
      });
    } else if (resubmissionCount > 0 && successCount === 0) {
      toast.success(`${resubmissionCount} DR${resubmissionCount > 1 ? 's' : ''} resubmitted successfully`);
    } else if (resubmissionCount > 0) {
      toast.success(`${successCount} new + ${resubmissionCount} resubmission${resubmissionCount > 1 ? 's' : ''} processed`);
    } else {
      toast.success(`${successCount} DR${successCount > 1 ? 's' : ''} processed successfully`);
    }

    if (successCount + resubmissionCount > 0) {
      onDRsAdded?.(successCount + resubmissionCount);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setInput(text);
    };
    reader.readAsText(file);
  }

  const drNumbers = extractDRNumbers(input);

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">📝</span>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Manual DR Entry
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Add DRs manually when WhatsApp bridge is down
          </p>
        </div>
      </div>

      {/* Project Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Project
        </label>
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="">Select project...</option>
          <option value="Lawley">Lawley</option>
          <option value="Mohadin">Mohadin</option>
          <option value="Mamelodi">Mamelodi</option>
          <option value="Velo Test">Velo Test</option>
          <option value="Marketing Activations">Marketing Activations</option>
        </select>
      </div>

      {/* Submitted Date */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Date Submitted
        </label>
        <input
          type="date"
          value={submittedDate}
          onChange={(e) => setSubmittedDate(e.target.value)}
          max={new Date().toISOString().split('T')[0]}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          When was this DR originally submitted? Defaults to today.
        </p>
      </div>

      {/* Text Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Drop Numbers (paste or type)
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste DR numbers here...&#10;DR1234567&#10;DR1234568&#10;Or any text containing DR numbers"
          rows={5}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 font-mono text-sm"
        />
        {drNumbers.length > 0 && (
          <p className="mt-1 text-sm text-green-600 dark:text-green-400">
            Found {drNumbers.length} DR number{drNumbers.length > 1 ? 's' : ''}: {drNumbers.slice(0, 5).join(', ')}
            {drNumbers.length > 5 && ` +${drNumbers.length - 5} more`}
          </p>
        )}
      </div>

      {/* File Upload */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Or upload a text file
        </label>
        <input
          type="file"
          accept=".txt,.csv"
          onChange={handleFileUpload}
          className="block w-full text-sm text-gray-500 dark:text-gray-400
            file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            dark:file:bg-blue-900/30 dark:file:text-blue-300
            hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50
            cursor-pointer"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isProcessing || drNumbers.length === 0 || !project}
        className="w-full px-4 py-3 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {isProcessing ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            <span>Processing {results.length}/{drNumbers.length}...</span>
          </>
        ) : (
          <>
            <span>Process {drNumbers.length} DR{drNumbers.length !== 1 ? 's' : ''}</span>
          </>
        )}
      </button>

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Results:</h4>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {results.map((result) => (
              <div
                key={result.dropNumber}
                className={`px-3 py-2 rounded text-sm ${
                  result.status === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                    : result.status === 'resubmission'
                    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-medium">{result.dropNumber}</span>
                  <span className="text-xs">{result.message}</span>
                </div>
                {result.status === 'resubmission' && result.previousSubmission && (
                  <div className="mt-1 pt-1 border-t border-amber-200 dark:border-amber-700 text-xs opacity-80">
                    <span>Previous: {result.previousSubmission.photo_count} photos</span>
                    {result.previousSubmission.feedback_sent && (
                      <span className="ml-2 px-1.5 py-0.5 bg-amber-200 dark:bg-amber-800 rounded">
                        Had feedback
                      </span>
                    )}
                    <span className="ml-2">
                      ({new Date(result.previousSubmission.snapshot_at).toISOString().split('T')[0]})
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
