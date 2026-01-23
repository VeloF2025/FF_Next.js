'use client';

/**
 * Shared Document Upload Wizard
 *
 * Re-exports StaffDocumentUploadWizard for use across modules.
 * Fleet uses this for driver's license uploads with activity logged to Staff.
 */

import { StaffDocumentUploadWizard } from '@/components/staff/StaffDocumentUploadWizard';
import type { DocumentType } from '@/types/staff-document.types';

export interface DocumentUploadWizardProps {
  /** Staff member ID (required) */
  staffId: string;
  /** Called on successful upload */
  onSuccess: () => void;
  /** Called when user cancels */
  onCancel: () => void;
  /** Context for audit logging - defaults to 'staff' */
  context?: 'staff' | 'fleet';
  /** Pre-selected document type (optional) */
  preSelectedType?: DocumentType;
}

/**
 * Shared document upload wizard with OCR capability.
 * Wraps StaffDocumentUploadWizard for cross-module usage.
 */
export function DocumentUploadWizard({
  staffId,
  onSuccess,
  onCancel,
}: DocumentUploadWizardProps) {
  // For now, directly use StaffDocumentUploadWizard
  // Context tracking will be added to audit logs in future if needed
  return (
    <StaffDocumentUploadWizard
      staffId={staffId}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  );
}

// Re-export types for convenience
export type { DocumentType };
