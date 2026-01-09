/**
 * Documents Section for Staff Form
 * Allows document upload and management when editing staff members
 */

import { FileText, Info } from 'lucide-react';
import { StaffDocumentList } from '@/components/staff/StaffDocumentList';
import { ContractType } from '@/types/staff.types';

interface DocumentsSectionProps {
  staffId: string | undefined;
  isEditing: boolean;
  contractType?: ContractType;
}

export function DocumentsSection({ staffId, isEditing, contractType }: DocumentsSectionProps) {
  // Only show when editing (need staff ID for document uploads)
  if (!isEditing || !staffId) {
    return (
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Documents
        </h2>
        <div className="p-6 bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Save the staff member first to upload documents.
              </p>
              <p className="text-xs text-[var(--ff-text-secondary)] opacity-70 mt-1">
                Required documents include ID, employment contract, and relevant certifications.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Determine if this is an employee or contractor based on contract type
  const isEmployee = contractType !== ContractType.CONTRACTOR;

  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4 flex items-center gap-2">
        <FileText className="w-5 h-5" />
        Documents
      </h2>
      <StaffDocumentList
        staffId={staffId}
        isEmployee={isEmployee}
        isAdmin={true}
      />
    </div>
  );
}
