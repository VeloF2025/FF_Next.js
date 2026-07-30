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
import type { HSTrainingType } from '../../types/training.types';
import type { StaffOption } from './TrainingCertificateDetails';
import type { TrainingCertificateFieldValues } from './TrainingCertificateFields';
import { TrainingCertificateDetails } from './TrainingCertificateDetails';
import { TrainingCertificateReview } from './TrainingCertificateReview';
import {
  ALLOWED_CERTIFICATE_TYPES,
  MAX_CERTIFICATE_FILE_SIZE,
} from '../../services/trainingCertificateValidation';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Imported rather than re-listed: the server validates against exactly these,
// and two hand-maintained copies drift the moment a format is added.
const ACCEPTED_EXTENSIONS = Object.keys(ALLOWED_CERTIFICATE_TYPES);

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
    if (file.size > MAX_CERTIFICATE_FILE_SIZE) return 'The certificate file exceeds the 10 MB limit';
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
        <TrainingCertificateDetails
          showEmployeePicker={!staffId}
          staffOptions={staffOptions}
          selectedStaffId={selectedStaffId}
          onStaffChange={setSelectedStaffId}
          types={types}
          selectedTypeIds={selectedTypeIds}
          onTypesChange={setSelectedTypeIds}
          values={values}
          fileName={file?.name ?? null}
          onFileChange={setFile}
          onValueChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
          onCancel={onCancel}
          onReview={toReview}
        />
      )}

      {(step === 'review' || step === 'submitting') && (
        <TrainingCertificateReview
          employeeName={
            staffOptions.find((s) => s.id === effectiveStaffId)?.name ?? 'Selected employee'
          }
          fileName={file?.name}
          values={values}
          competencyNames={selectedNames}
          busy={busy}
          onBack={() => setStep('details')}
          onSubmit={submit}
        />
      )}

    </div>
  );
}
