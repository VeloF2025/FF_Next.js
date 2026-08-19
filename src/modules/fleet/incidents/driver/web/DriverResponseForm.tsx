/**
 * The driver's optional explanation / follow-up / evidence form (PR7
 * Task 7, design §§7, 15, 16). Text is submitted first and independently
 * of any selected files — a file failure never retracts the already
 * accepted explanation, and each file gets its own retry rather than
 * blocking or re-sending the text (design §16).
 *
 * Idempotency: a failed text submission keeps the same key so a retry is
 * the same logical attempt server-side; a successful one rotates to a
 * fresh key so the next submission (a follow-up) is a genuinely new one.
 */
import React from 'react';
import type { DriverConcernCategory, DriverSubmissionResult } from '../types';
import { DriverIncidentApiError, submitMyFleetIncidentResponse, uploadMyFleetIncidentEvidence } from './driverIncidentApi';
import { CONCERN_CATEGORY_LABELS } from './driverPortalLabels';

export interface DriverResponseFormProps {
  incidentId: string;
  enabledConcernCategories: DriverConcernCategory[];
  hasResponded: boolean;
  onSubmitted: (result: DriverSubmissionResult) => void;
}

interface FileUploadState { file: File; status: 'pending' | 'uploading' | 'success' | 'error'; error: string | null }

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected file'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DriverIncidentApiError || error instanceof Error) return error.message;
  return fallback;
}

export function DriverResponseForm({ incidentId, enabledConcernCategories, hasResponded, onSubmitted }: DriverResponseFormProps): React.ReactElement {
  const [explanation, setExplanation] = React.useState('');
  const [concernCategory, setConcernCategory] = React.useState<DriverConcernCategory | ''>('');
  const [files, setFiles] = React.useState<FileUploadState[]>([]);
  const [idempotencyKey, setIdempotencyKey] = React.useState(newIdempotencyKey);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [lastSent, setLastSent] = React.useState(false);

  const uploadOneFile = React.useCallback(async (index: number, file: File) => {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'uploading', error: null } : f)));
    try {
      const base64 = await fileToBase64(file);
      await uploadMyFleetIncidentEvidence(incidentId, { mimeType: file.type, base64, filename: file.name, description: null });
      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'success', error: null } : f)));
    } catch (error) {
      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'error', error: apiErrorMessage(error, 'Upload failed') } : f)));
    }
  }, [incidentId]);

  const handleFilesSelected = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    setFiles((prev) => [...prev, ...selected.map((file) => ({ file, status: 'pending' as const, error: null }))]);
    event.target.value = '';
  }, []);

  const handleSubmit = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = explanation.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setLastSent(false);
    try {
      const result = await submitMyFleetIncidentResponse(incidentId, {
        submissionKind: hasResponded ? 'follow_up' : 'response',
        explanation: trimmed,
        concernCategory: concernCategory || null,
        idempotencyKey,
      });
      setSubmitting(false);
      setLastSent(true);
      setExplanation('');
      setConcernCategory('');
      setIdempotencyKey(newIdempotencyKey());
      onSubmitted(result);
      for (let i = 0; i < files.length; i += 1) {
        const fileState = files[i];
        if (fileState && fileState.status !== 'success') {
          // Sequential per design §16: one file at a time, independent of the others.
          await uploadOneFile(i, fileState.file);
        }
      }
    } catch (error) {
      setSubmitting(false);
      // Explanation/concern/files are deliberately NOT cleared here — design
      // §15: the form retains text and selected files when a recoverable
      // request fails, and idempotencyKey is unchanged so a retry replays
      // the same logical attempt.
      setSubmitError(apiErrorMessage(error, 'Could not submit your response.'));
    }
  }, [explanation, concernCategory, idempotencyKey, submitting, hasResponded, incidentId, files, onSubmitted, uploadOneFile]);

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div>
        <label htmlFor="driver-response-explanation" className="mb-1 block text-sm font-medium text-neutral-200">
          Explanation
        </label>
        <textarea
          id="driver-response-explanation"
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          rows={4}
          placeholder="Share anything that helps explain this record…"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        />
      </div>

      {enabledConcernCategories.length > 0 && (
        <div>
          <label htmlFor="driver-response-concern" className="mb-1 block text-sm font-medium text-neutral-200">
            Is something in this record wrong? (optional)
          </label>
          <select
            id="driver-response-concern"
            value={concernCategory}
            onChange={(event) => setConcernCategory(event.target.value as DriverConcernCategory | '')}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
          >
            <option value="">No — just explaining</option>
            {enabledConcernCategories.map((category) => (
              <option key={category} value={category}>{CONCERN_CATEGORY_LABELS[category]}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="driver-response-attach" className="mb-1 block text-sm font-medium text-neutral-200">
          Attach evidence (optional)
        </label>
        <input id="driver-response-attach" type="file" multiple onChange={handleFilesSelected} className="block w-full text-sm text-neutral-300" />
      </div>

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((fileState, index) => (
            <li key={`${fileState.file.name}-${index}`} className="flex items-center justify-between gap-2 text-xs text-neutral-300">
              <span className="truncate">{fileState.file.name}</span>
              <span className="flex items-center gap-2">
                {fileState.status === 'uploading' && <span className="text-neutral-400">Uploading…</span>}
                {fileState.status === 'success' && <span className="text-emerald-300">Uploaded</span>}
                {fileState.status === 'error' && (
                  <>
                    <span className="text-red-300">Failed</span>
                    <button
                      type="button"
                      onClick={() => void uploadOneFile(index, fileState.file)}
                      className="touch-manipulation rounded-md border border-red-700 px-2 py-1 text-red-200 hover:bg-red-950/40"
                    >
                      {`Retry ${fileState.file.name}`}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {submitError && (
        <div role="alert" className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          {submitError}
        </div>
      )}
      {lastSent && !submitError && (
        <p className="text-sm text-emerald-300">Sent. You can add a follow-up at any time while this stays open.</p>
      )}

      <button
        type="submit"
        disabled={submitting || explanation.trim().length === 0}
        className="w-full touch-manipulation rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      >
        {submitting ? 'Submitting…' : submitError ? 'Retry submit' : 'Submit'}
      </button>
    </form>
  );
}
