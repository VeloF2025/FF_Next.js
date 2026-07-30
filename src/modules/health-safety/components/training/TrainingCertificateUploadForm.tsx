/**
 * The one certificate upload workflow, shared by both entry points.
 *
 * `staffId` supplied  -> employee profile: the person is already known.
 * `staffId` omitted   -> H&S module: the person is chosen here.
 *
 * Explicit details -> review -> submitting states, because a certificate that
 * classifies several statutory competencies deserves a look before it is filed.
 * `onSuccess` fires only after the API confirms the document AND its pending
 * competency rows — never optimistically.
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Loader2, Upload } from 'lucide-react';
import type { HSTrainingType } from '../../types/training.types';
import { TrainingTypeMultiSelect, TrainingTypeChips } from './TrainingTypeMultiSelect';
import {
  TrainingCertificateFields,
  type TrainingCertificateFieldValues,
} from './TrainingCertificateFields';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export interface TrainingCertificateUploadResult {
  documentId: string;
  trainingRecordIds: string[];
  verificationStatus: 'pending';
}

export interface TrainingCertificateUploadFormProps {
  staffId?: string;
  onSuccess(result: TrainingCertificateUploadResult): void;
  onCancel(): void;
}

interface StaffOption {
  id: string;
  name: string;
}

const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';
const inputCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export function TrainingCertificateUploadForm({
  staffId,
  onSuccess,
  onCancel,
}: TrainingCertificateUploadFormProps) {
  const { data: typesData } = useSWR('/api/health-safety/training/types', fetcher);
  // Only fetched when the employee still has to be chosen.
  const { data: pickerData } = useSWR(
    staffId ? null : '/api/health-safety/training/pickers',
    fetcher
  );

  // Memoised because `?? []` yields a fresh array on every render, which would
  // re-run the selected-names memo below each time.
  const types: HSTrainingType[] = useMemo(
    () => typesData?.data?.types ?? [],
    [typesData]
  );
  const staffOptions: StaffOption[] = pickerData?.data?.staff ?? [];

  const [step, setStep] = useState<'details' | 'review' | 'submitting'>('details');
  const [selectedStaffId, setSelectedStaffId] = useState(staffId ?? '');
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [values, setValues] = useState<TrainingCertificateFieldValues>({
    certificateNumber: '',
    provider: '',
    completedDate: '',
    expiryDate: '',
  });
  const [error, setError] = useState<string | null>(null);

  const effectiveStaffId = staffId ?? selectedStaffId;
  const busy = step === 'submitting';

  const selectedNames = useMemo(
    () => types.filter((t) => selectedTypeIds.includes(t.id)).map((t) => t.name),
    [types, selectedTypeIds]
  );

  function validate(): string | null {
    if (!effectiveStaffId) return 'Select the employee this certificate belongs to';
    if (!file) return 'Select the certificate file';
    if (!ACCEPTED_EXTENSIONS.includes(extensionOf(file.name))) {
      return 'Upload a PDF, JPG, PNG, DOC or DOCX certificate';
    }
    if (file.size > MAX_FILE_SIZE) return 'The certificate file exceeds the 10 MB limit';
    if (selectedTypeIds.length === 0) return 'Select at least one training type';
    if (!values.certificateNumber.trim()) return 'Enter the certificate number';
    if (!values.provider.trim()) return 'Enter the training provider';
    if (!values.completedDate) return 'Enter the completion date';
    if (values.expiryDate && values.expiryDate < values.completedDate) {
      return 'The expiry date cannot be before the completion date';
    }
    return null;
  }

  function toReview() {
    const problem = validate();
    setError(problem);
    if (!problem) setStep('review');
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      setStep('details');
      return;
    }

    setError(null);
    setStep('submitting');

    const body = new FormData();
    body.append('staffId', effectiveStaffId);
    for (const id of selectedTypeIds) body.append('trainingTypeIds', id);
    body.append('certificateNumber', values.certificateNumber.trim());
    body.append('provider', values.provider.trim());
    body.append('completedDate', values.completedDate);
    if (values.expiryDate) body.append('expiryDate', values.expiryDate);
    body.append('file', file as File);

    try {
      const res = await fetch('/api/staff-training-certificates-upload', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        // Stay on review with what the user typed intact — a duplicate
        // certificate number is corrected here, not re-entered from scratch.
        setError(json?.error?.message || 'Failed to submit the certificate');
        setStep('review');
        return;
      }
      onSuccess(json.data as TrainingCertificateUploadResult);
    } catch {
      setError('Network error submitting the certificate');
      setStep('review');
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm"
        >
          {error}
        </div>
      )}

      {step === 'details' && (
        <div className="space-y-4">
          {!staffId && (
            <div>
              <label htmlFor="certificate-staff" className={labelCls}>
                Employee *
              </label>
              <select
                id="certificate-staff"
                className={inputCls}
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
              >
                <option value="">Select employee…</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <TrainingCertificateFields
            values={values}
            fileName={file?.name ?? null}
            onFileChange={setFile}
            onValueChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
          />

          <TrainingTypeMultiSelect
            types={types}
            selectedIds={selectedTypeIds}
            onChange={setSelectedTypeIds}
          />

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={toReview}
              className="px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors"
            >
              Review
            </button>
          </div>
        </div>
      )}

      {(step === 'review' || step === 'submitting') && (
        <div className="space-y-4">
          <div
            data-testid="certificate-review"
            className="space-y-3 p-4 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]"
          >
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--ff-text-secondary)]">Employee</dt>
                <dd className="text-[var(--ff-text-primary)]">
                  {staffOptions.find((s) => s.id === effectiveStaffId)?.name ?? 'Selected employee'}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ff-text-secondary)]">File</dt>
                <dd className="text-[var(--ff-text-primary)]">{file?.name}</dd>
              </div>
              <div>
                <dt className="text-[var(--ff-text-secondary)]">Certificate number</dt>
                <dd className="text-[var(--ff-text-primary)]">{values.certificateNumber}</dd>
              </div>
              <div>
                <dt className="text-[var(--ff-text-secondary)]">Provider</dt>
                <dd className="text-[var(--ff-text-primary)]">{values.provider}</dd>
              </div>
              <div>
                <dt className="text-[var(--ff-text-secondary)]">Completed</dt>
                <dd className="text-[var(--ff-text-primary)]">{values.completedDate}</dd>
              </div>
              <div>
                <dt className="text-[var(--ff-text-secondary)]">Expiry</dt>
                <dd className="text-[var(--ff-text-primary)]">
                  {values.expiryDate || 'From each competency’s validity period'}
                </dd>
              </div>
            </dl>
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)] mb-1.5">Competencies</p>
              <TrainingTypeChips names={selectedNames} />
            </div>
            <p className="text-xs text-[var(--ff-text-secondary)]">
              Submitted as pending. It counts towards competency only once a verifier approves it.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep('details')}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg disabled:opacity-60"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {busy ? 'Submitting…' : 'Submit for verification'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
