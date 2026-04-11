/**
 * Enhanced Onboarding Stage Card with Document Integration
 * Shows required documents with upload status and inline upload
 * Uses FF design system CSS variables for dark theme consistency
 */

'use client';

import { useState, useEffect } from 'react';
import { Upload, CheckCircle2, XCircle } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { ContractorDocument, DOCUMENT_TYPE_LABELS, DocumentType } from '@/types/contractor-document.types';
import { DocumentUploadForm } from '../DocumentUploadForm';
import { VerificationPanel } from './VerificationPanel';
import { log } from '@/lib/logger';

export interface OnboardingStage {
  id: number;
  contractorId: string | number;
  stageName: string;
  stageOrder: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completionPercentage: number;
  requiredDocuments: string[];
  completedDocuments: string[];
  startedAt?: Date;
  completedAt?: Date;
  dueDate?: Date;
  notes?: string;
}

interface OnboardingStageCardEnhancedProps {
  stage: OnboardingStage;
  onUpdateStage: (stageId: number, updates: {
    status?: 'pending' | 'in_progress' | 'completed' | 'skipped';
    completionPercentage?: number;
    notes?: string;
  }) => Promise<void>;
}

const STATUS_CONFIG = {
  completed: {
    accent: 'border-t-green-500',
    badgeColor: 'bg-green-500/20 text-green-400',
    icon: '✓',
    label: 'Completed',
  },
  in_progress: {
    accent: 'border-t-blue-500',
    badgeColor: 'bg-blue-500/20 text-blue-400',
    icon: '↻',
    label: 'In Progress',
  },
  skipped: {
    accent: 'border-t-gray-500',
    badgeColor: 'bg-gray-500/20 text-gray-400',
    icon: '⤳',
    label: 'Skipped',
  },
  pending: {
    accent: 'border-t-amber-500',
    badgeColor: 'bg-amber-500/20 text-amber-400',
    icon: '○',
    label: 'Pending',
  },
} as const;

export function OnboardingStageCardEnhanced({ stage, onUpdateStage }: OnboardingStageCardEnhancedProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(stage.notes || '');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadDocType, setUploadDocType] = useState<DocumentType | null>(null);
  const [documents, setDocuments] = useState<ContractorDocument[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [verificationPassed, setVerificationPassed] = useState(false);

  const isVerificationStage = stage.stageName === 'Company Verification';

  // Fetch contractor documents
  useEffect(() => {
    fetchDocuments();
  }, [stage.contractorId]);

  const fetchDocuments = async () => {
    try {
      const response = await fetch(`/api/contractors-documents?contractorId=${stage.contractorId}`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch contractor documents', { error: err, contractorId: stage.contractorId }, 'OnboardingStageCardEnhanced');
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const handleStatusChange = async (newStatus: OnboardingStage['status']) => {
    if (newStatus === 'completed') {
      if (isVerificationStage && !verificationPassed) {
        notificationService.warning('Cannot complete stage. Run company verification first.');
        return;
      }
      if (!isVerificationStage && stage.requiredDocuments.length > 0) {
        const missingDocs = getMissingDocuments();
        if (missingDocs.length > 0) {
          notificationService.warning(`Cannot complete stage. Missing documents: ${missingDocs.map(d => DOCUMENT_TYPE_LABELS[d as DocumentType]).join(', ')}`);
          return;
        }
      }
    }

    setIsUpdating(true);
    try {
      await onUpdateStage(stage.id, { status: newStatus });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveNotes = async () => {
    setIsUpdating(true);
    try {
      await onUpdateStage(stage.id, { notes });
      setShowNotes(false);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUploadClick = (docType: DocumentType) => {
    setUploadDocType(docType);
    setShowUpload(true);
  };

  const handleUploadSuccess = () => {
    setShowUpload(false);
    setUploadDocType(null);
    fetchDocuments();
  };

  const getDocumentStatus = (docType: string) => {
    return documents.find(d => d.documentType === docType && d.status === 'approved');
  };

  const getMissingDocuments = () => {
    return stage.requiredDocuments.filter(docType => !getDocumentStatus(docType));
  };

  const config = STATUS_CONFIG[stage.status] || STATUS_CONFIG.pending;
  const completedDocsCount = stage.requiredDocuments.filter(docType => getDocumentStatus(docType)).length;
  const documentProgress = stage.requiredDocuments.length > 0
    ? Math.round((completedDocsCount / stage.requiredDocuments.length) * 100)
    : 100;
  const allDocsComplete = isVerificationStage
    ? verificationPassed
    : (stage.requiredDocuments.length > 0 && getMissingDocuments().length === 0);

  return (
    <div className={`rounded-lg border border-[var(--ff-border-light)] border-t-4 ${config.accent} bg-[var(--ff-bg-card)] p-4 transition-all`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              {stage.stageOrder}. {stage.stageName}
            </h4>
          </div>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.badgeColor}`}>
            {config.label}
          </span>
        </div>
      </div>

      {/* Document Progress Bar */}
      {stage.requiredDocuments.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-[var(--ff-text-secondary)]">Documents</span>
            <span className="text-sm font-bold text-[var(--ff-text-primary)]">
              {completedDocsCount} / {stage.requiredDocuments.length}
            </span>
          </div>
          <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-300 ${allDocsComplete ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${documentProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Verification Panel for Company Verification stage */}
      {isVerificationStage && (
        <div className="mb-4">
          <VerificationPanel
            contractorId={String(stage.contractorId)}
            onVerificationComplete={(passed) => setVerificationPassed(passed)}
          />
        </div>
      )}

      {/* Required Documents List */}
      {!isVerificationStage && stage.requiredDocuments.length > 0 && !isLoadingDocs && (
        <div className="space-y-2 mb-4 bg-[var(--ff-bg-secondary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
          <h5 className="text-xs font-semibold text-[var(--ff-text-tertiary)] uppercase mb-2">Required Documents</h5>
          {stage.requiredDocuments.map((docType) => {
            const doc = getDocumentStatus(docType);
            const isUploaded = !!doc;

            return (
              <div
                key={docType}
                className="flex items-center justify-between py-2 px-2 rounded hover:bg-[var(--ff-bg-tertiary)]"
              >
                <div className="flex items-center gap-2 flex-1">
                  {isUploaded ? (
                    <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-[var(--ff-text-tertiary)] flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${isUploaded ? 'text-[var(--ff-text-primary)] font-medium' : 'text-[var(--ff-text-secondary)]'}`}>
                      {DOCUMENT_TYPE_LABELS[docType as DocumentType]}
                    </p>
                    {isUploaded && doc && (
                      <p className="text-xs text-[var(--ff-text-tertiary)]">
                        Uploaded {new Date(doc.createdAt).toISOString().split('T')[0]}
                      </p>
                    )}
                  </div>
                </div>
                {!isUploaded && (
                  <button
                    onClick={() => handleUploadClick(docType as DocumentType)}
                    className="ml-2 inline-flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex-shrink-0"
                  >
                    <Upload className="h-3 w-3" />
                    Upload
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Timestamps */}
      <div className="text-xs text-[var(--ff-text-tertiary)] space-y-1 mb-3">
        {stage.startedAt && (
          <div>Started: {new Date(stage.startedAt).toISOString().split('T')[0]}</div>
        )}
        {stage.completedAt && (
          <div>Completed: {new Date(stage.completedAt).toISOString().split('T')[0]}</div>
        )}
        {stage.dueDate && !stage.completedAt && (
          <div>Due: {new Date(stage.dueDate).toISOString().split('T')[0]}</div>
        )}
      </div>

      {/* Notes Section */}
      {showNotes ? (
        <div className="mb-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full p-2 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-sm placeholder:text-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={3}
            placeholder="Add notes..."
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSaveNotes}
              disabled={isUpdating}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setShowNotes(false)}
              className="px-3 py-1 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] text-sm rounded hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        stage.notes && (
          <div className="mb-3 p-2 bg-[var(--ff-bg-secondary)] rounded text-sm text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)]">
            {stage.notes}
          </div>
        )
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {stage.status === 'pending' && (
          <button
            onClick={() => handleStatusChange('in_progress')}
            disabled={isUpdating}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Start Stage
          </button>
        )}
        {stage.status === 'in_progress' && (
          <>
            <button
              onClick={() => handleStatusChange('completed')}
              disabled={isUpdating || !allDocsComplete}
              className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={!allDocsComplete
                ? (isVerificationStage ? 'Complete verification first' : 'Upload all required documents first')
                : 'Mark stage as complete'}
            >
              Mark Complete
            </button>
            {!allDocsComplete && (
              <span className="text-xs text-amber-400 self-center italic">
                {isVerificationStage ? 'Complete verification to proceed' : 'Upload all documents to complete'}
              </span>
            )}
          </>
        )}
        {stage.status !== 'skipped' && stage.status !== 'completed' && (
          <button
            onClick={() => handleStatusChange('skipped')}
            disabled={isUpdating}
            className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-sm rounded hover:bg-[var(--ff-bg-hover)] disabled:opacity-50 transition-colors"
          >
            Skip
          </button>
        )}
        {!showNotes && (
          <button
            onClick={() => setShowNotes(true)}
            className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-sm rounded hover:bg-[var(--ff-bg-hover)] transition-colors"
          >
            {stage.notes ? 'Edit Notes' : 'Add Notes'}
          </button>
        )}
      </div>

      {/* Upload Modal */}
      {showUpload && uploadDocType && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <DocumentUploadForm
              contractorId={String(stage.contractorId)}
              onSuccess={handleUploadSuccess}
              onCancel={() => {
                setShowUpload(false);
                setUploadDocType(null);
              }}
              defaultDocumentType={uploadDocType}
            />
          </div>
        </div>
      )}
    </div>
  );
}
