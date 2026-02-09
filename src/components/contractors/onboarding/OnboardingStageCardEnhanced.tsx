/**
 * Enhanced Onboarding Stage Card with Document Integration
 * Shows required documents with upload status and inline upload
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Upload, CheckCircle2, XCircle, FileText, Plus } from 'lucide-react';
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

  const getStatusConfig = () => {
    switch (stage.status) {
      case 'completed':
        return {
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          textColor: 'text-green-800',
          badgeColor: 'bg-green-100 text-green-800',
          icon: '✓',
          label: 'Completed',
        };
      case 'in_progress':
        return {
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          textColor: 'text-blue-800',
          badgeColor: 'bg-blue-100 text-blue-800',
          icon: '↻',
          label: 'In Progress',
        };
      case 'skipped':
        return {
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          textColor: 'text-gray-600',
          badgeColor: 'bg-gray-100 text-gray-600',
          icon: '⤳',
          label: 'Skipped',
        };
      default:
        return {
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          textColor: 'text-yellow-800',
          badgeColor: 'bg-yellow-100 text-yellow-800',
          icon: '○',
          label: 'Pending',
        };
    }
  };

  const handleStatusChange = async (newStatus: OnboardingStage['status']) => {
    // Validate completion requirements
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

  // Check which required documents are uploaded
  const getDocumentStatus = (docType: string) => {
    return documents.find(d => d.documentType === docType && d.status === 'approved');
  };

  const getMissingDocuments = () => {
    return stage.requiredDocuments.filter(docType => !getDocumentStatus(docType));
  };

  const config = getStatusConfig();
  const completedDocsCount = stage.requiredDocuments.filter(docType => getDocumentStatus(docType)).length;
  const documentProgress = stage.requiredDocuments.length > 0
    ? Math.round((completedDocsCount / stage.requiredDocuments.length) * 100)
    : 100;
  const allDocsComplete = isVerificationStage
    ? verificationPassed
    : (stage.requiredDocuments.length > 0 && getMissingDocuments().length === 0);

  return (
    <div className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-4 transition-all`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-2xl ${config.textColor}`}>{config.icon}</span>
            <h4 className="text-lg font-semibold text-gray-900">
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
            <span className="text-sm font-medium text-gray-700">Documents</span>
            <span className="text-sm font-bold text-gray-900">
              {completedDocsCount} / {stage.requiredDocuments.length}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-300 ${allDocsComplete ? 'bg-green-600' : 'bg-blue-600'}`}
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
        <div className="space-y-2 mb-4 bg-white rounded p-3 border border-gray-200">
          <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">Required Documents</h5>
          {stage.requiredDocuments.map((docType) => {
            const doc = getDocumentStatus(docType);
            const isUploaded = !!doc;

            return (
              <div
                key={docType}
                className="flex items-center justify-between py-2 px-2 rounded hover:bg-gray-50"
              >
                <div className="flex items-center gap-2 flex-1">
                  {isUploaded ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${isUploaded ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>
                      {DOCUMENT_TYPE_LABELS[docType as DocumentType]}
                    </p>
                    {isUploaded && doc && (
                      <p className="text-xs text-gray-500">
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
      <div className="text-xs text-gray-600 space-y-1 mb-3">
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
            className="w-full p-2 border border-gray-300 rounded text-sm"
            rows={3}
            placeholder="Add notes..."
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSaveNotes}
              disabled={isUpdating}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setShowNotes(false)}
              className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        stage.notes && (
          <div className="mb-3 p-2 bg-white rounded text-sm text-gray-700 border border-gray-200">
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
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Start Stage
          </button>
        )}
        {stage.status === 'in_progress' && (
          <>
            <button
              onClick={() => handleStatusChange('completed')}
              disabled={isUpdating || !allDocsComplete}
              className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={!allDocsComplete
                ? (isVerificationStage ? 'Complete verification first' : 'Upload all required documents first')
                : 'Mark stage as complete'}
            >
              Mark Complete
            </button>
            {!allDocsComplete && (
              <span className="text-xs text-amber-600 self-center italic">
                {isVerificationStage ? '⚠ Complete verification to proceed' : '⚠ Upload all documents to complete'}
              </span>
            )}
          </>
        )}
        {stage.status !== 'skipped' && stage.status !== 'completed' && (
          <button
            onClick={() => handleStatusChange('skipped')}
            disabled={isUpdating}
            className="px-3 py-1.5 bg-gray-400 text-white text-sm rounded hover:bg-gray-500 disabled:opacity-50"
          >
            Skip
          </button>
        )}
        {!showNotes && (
          <button
            onClick={() => setShowNotes(true)}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
          >
            {stage.notes ? 'Edit Notes' : 'Add Notes'}
          </button>
        )}
      </div>

      {/* Upload Modal */}
      {showUpload && uploadDocType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
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
