/**
 * Modal wrapper for the certificate workflow on an employee profile.
 *
 * A thin shell on purpose: the employee is already known, so this fixes
 * `staffId` and delegates everything else to the shared form. The 690-line
 * generic document wizard is deliberately untouched — a certificate needs
 * competency selection and no OCR, which is a different workflow wearing the
 * same word "upload".
 */

import { X } from 'lucide-react';
import {
  TrainingCertificateUploadForm,
  type TrainingCertificateUploadResult,
} from './TrainingCertificateUploadForm';

export interface TrainingCertificateUploadDialogProps {
  isOpen: boolean;
  staffId: string;
  onClose(): void;
  onUploaded(result: TrainingCertificateUploadResult): void;
}

export function TrainingCertificateUploadDialog({
  isOpen,
  staffId,
  onClose,
  onUploaded,
}: TrainingCertificateUploadDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload training certificate"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="flex items-center justify-between p-6 border-b border-[var(--ff-border-light)]">
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            Upload training certificate
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <TrainingCertificateUploadForm
            staffId={staffId}
            onSuccess={onUploaded}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
