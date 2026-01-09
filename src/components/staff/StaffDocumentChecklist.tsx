'use client';

/**
 * Staff Document Checklist
 * Shows required documents status for employees and independent contractors
 */

import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import {
  DocumentType,
  StaffDocument,
  DOCUMENT_TYPE_LABELS,
  REQUIRED_DOCUMENTS_EMPLOYEE,
  REQUIRED_DOCUMENTS_IC,
  getRequiredDocuments,
} from '@/types/staff-document.types';

interface StaffDocumentChecklistProps {
  documents: StaffDocument[];
  isEmployee: boolean;
}

export function StaffDocumentChecklist({ documents, isEmployee }: StaffDocumentChecklistProps) {
  const requiredDocs = getRequiredDocuments(isEmployee);

  // Check which required documents have been uploaded
  const uploadedDocTypes = new Set(documents.map(d => d.documentType));

  const missingDocs = requiredDocs.filter(docType => !uploadedDocTypes.has(docType));
  const uploadedRequiredDocs = requiredDocs.filter(docType => uploadedDocTypes.has(docType));

  const allRequiredUploaded = missingDocs.length === 0;

  return (
    <div className="space-y-3">
      {/* Warning banner if docs missing */}
      {!allRequiredUploaded && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0" />
          <span className="text-sm text-amber-400">
            {missingDocs.length} required document{missingDocs.length > 1 ? 's' : ''} missing
          </span>
        </div>
      )}

      {/* Checklist */}
      <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
        <h4 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">
          Required Documents ({isEmployee ? 'Employee' : 'Independent Contractor'})
        </h4>

        <div className="space-y-2">
          {requiredDocs.map((docType) => {
            const isUploaded = uploadedDocTypes.has(docType);
            const uploadedDoc = documents.find(d => d.documentType === docType);

            return (
              <div
                key={docType}
                className={`flex items-center justify-between p-2 rounded-md ${
                  isUploaded
                    ? 'bg-green-500/10 border border-green-500/20'
                    : 'bg-red-500/10 border border-red-500/20'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isUploaded ? (
                    <CheckCircle className="h-4 w-4 text-green-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400" />
                  )}
                  <span className={`text-sm ${isUploaded ? 'text-green-400' : 'text-red-400'}`}>
                    {DOCUMENT_TYPE_LABELS[docType]}
                  </span>
                </div>

                {isUploaded && uploadedDoc && (
                  <span className="text-xs text-[var(--ff-text-secondary)] truncate max-w-[150px]">
                    {uploadedDoc.documentName}
                  </span>
                )}

                {!isUploaded && (
                  <span className="text-xs text-red-400">Not uploaded</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Progress indicator */}
        <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between text-xs text-[var(--ff-text-secondary)] mb-1">
            <span>Completion</span>
            <span>{uploadedRequiredDocs.length}/{requiredDocs.length}</span>
          </div>
          <div className="w-full bg-[var(--ff-border-light)] rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                allRequiredUploaded ? 'bg-green-500' : 'bg-amber-500'
              }`}
              style={{ width: `${(uploadedRequiredDocs.length / requiredDocs.length) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
