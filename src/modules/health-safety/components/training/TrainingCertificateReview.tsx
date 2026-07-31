/**
 * The review step of a certificate submission.
 *
 * Presentational and controlled, mirroring TrainingCertificateFields: the
 * parent form owns every value and both actions. It exists because a single
 * certificate can classify several statutory competencies at once, and that is
 * worth showing back before it is filed.
 */

import { Loader2, Upload } from 'lucide-react';
import { TrainingTypeChips } from './TrainingTypeMultiSelect';
import type { TrainingCertificateFieldValues } from './TrainingCertificateFields';

export interface TrainingCertificateReviewProps {
  employeeName: string;
  fileName: string | undefined;
  values: TrainingCertificateFieldValues;
  competencyNames: string[];
  busy: boolean;
  onBack(): void;
  onSubmit(): void;
}

export function TrainingCertificateReview({
  employeeName,
  fileName,
  values,
  competencyNames,
  busy,
  onBack,
  onSubmit,
}: TrainingCertificateReviewProps) {
  return (
    <div className="space-y-4">
      <div
        data-testid="certificate-review"
        className="space-y-3 p-4 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]"
      >
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--ff-text-secondary)]">Employee</dt>
            <dd className="text-[var(--ff-text-primary)]">{employeeName}</dd>
          </div>
          <div>
            <dt className="text-[var(--ff-text-secondary)]">File</dt>
            <dd className="text-[var(--ff-text-primary)]">{fileName}</dd>
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
          <TrainingTypeChips names={competencyNames} />
        </div>
        <p className="text-xs text-[var(--ff-text-secondary)]">
          Submitted as pending. It counts towards competency only once a verifier approves it.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onBack}
          className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg disabled:opacity-60"
        >
          Back
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSubmit}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {busy ? 'Submitting…' : 'Submit for verification'}
        </button>
      </div>
    </div>
  );
}
