'use client';

import { useState, useEffect } from 'react';
import {
  Building2,
  Shield,
  Receipt,
  FileCheck,
  AlertTriangle,
  CheckCircle2,
  CheckCircle,
  Clock,
  XCircle,
  Upload,
  FileWarning,
  CreditCard,
  MapPin,
  Briefcase,
  User,
  BadgeCheck,
} from 'lucide-react';
import type { StaffMember } from '@/types/staff';
import { formatDisplayDate } from '@/utils/dateFormat';
import {
  SA_CONTRACT_CONFIG,
  SA_CONTRACT_TYPE_LABELS,
  UIF_STATUS_LABELS,
  COIDA_STATUS_LABELS,
  TAX_STATUS_LABELS,
  UIFStatus,
  COIDAStatus,
  TaxStatus,
  SAContractType,
} from '@/types/staff/compliance.types';
import { log } from '@/lib/logger';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface DocumentStatus {
  type: string;
  label: string;
  required: boolean;
  uploaded: boolean;
  verified: boolean;
  pending: boolean;
  rejected: boolean;
  expired: boolean;
  documentId?: string;
  documentNumber?: string;
  expiryDate?: string;
  verifiedAt?: string;
}

interface ComplianceStatus {
  isCompliant: boolean;
  requiredComplete: number;
  requiredTotal: number;
  optionalComplete: number;
  optionalTotal: number;
  documents: DocumentStatus[];
}

interface ComplianceTabProps {
  staff: StaffMember;
  onUploadDocument?: (documentType: string) => void;
}

export function ComplianceTab({ staff, onUploadDocument }: ComplianceTabProps) {
  const [complianceStatus, setComplianceStatus] = useState<ComplianceStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const formatDate = (date: unknown): string => {
    return formatDisplayDate(date as Parameters<typeof formatDisplayDate>[0], 'N/A');
  };

  // Get contract config for dynamic field visibility
  const contractType = staff.saContractType as SAContractType | undefined;
  const contractConfig = contractType ? SA_CONTRACT_CONFIG[contractType] : null;
  const isEmployee = contractConfig?.isEmployee ?? true;

  // Fetch compliance status
  useEffect(() => {
    const fetchComplianceStatus = async () => {
      try {
        const response = await fetch(`/api/staff/${staff.id}/compliance`);
        if (response.ok) {
          const data = await response.json();
          setComplianceStatus(data);
        }
      } catch (error) {
        log.error('Failed to fetch compliance status', { error, staffId: staff.id }, 'ComplianceTab');
      } finally {
        setIsLoading(false);
      }
    };

    if (staff.id) {
      fetchComplianceStatus();
    }
  }, [staff.id]);

  const getStatusColor = (status: string, type: 'uif' | 'coida' | 'tax') => {
    if (type === 'uif') {
      switch (status) {
        case UIFStatus.REGISTERED: return 'bg-green-500/20 text-green-400';
        case UIFStatus.PENDING: return 'bg-yellow-500/20 text-yellow-400';
        case UIFStatus.EXEMPT:
        case UIFStatus.NOT_APPLICABLE: return 'bg-gray-500/20 text-gray-400';
        default: return 'bg-gray-500/20 text-gray-400';
      }
    }
    if (type === 'coida') {
      switch (status) {
        case COIDAStatus.COVERED: return 'bg-green-500/20 text-green-400';
        case COIDAStatus.PENDING: return 'bg-yellow-500/20 text-yellow-400';
        case COIDAStatus.NOT_APPLICABLE: return 'bg-gray-500/20 text-gray-400';
        default: return 'bg-gray-500/20 text-gray-400';
      }
    }
    if (type === 'tax') {
      switch (status) {
        case TaxStatus.PAYE: return 'bg-blue-500/20 text-blue-400';
        case TaxStatus.PROVISIONAL: return 'bg-purple-500/20 text-purple-400';
        default: return 'bg-gray-500/20 text-gray-400';
      }
    }
    return 'bg-gray-500/20 text-gray-400';
  };

  return (
    <div className="space-y-6">
      {/* Contract Type Info */}
      <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Contract Type</p>
            <p className="text-lg font-medium text-[var(--ff-text-primary)]">
              {contractType ? SA_CONTRACT_TYPE_LABELS[contractType] : 'Not specified'}
            </p>
          </div>
          <span className={`px-3 py-1 text-sm rounded-full ${
            isEmployee ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
          }`}>
            {isEmployee ? 'Employee' : 'Independent Contractor'}
          </span>
        </div>
        {contractConfig && (
          <p className="text-sm text-[var(--ff-text-secondary)] mt-2">{contractConfig.description}</p>
        )}
      </div>

      {/* Statutory Compliance - Only for Employees */}
      {isEmployee && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Statutory Compliance</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* UIF Status */}
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-5 h-5 text-[var(--ff-text-muted)]" />
                <p className="text-sm text-[var(--ff-text-secondary)]">UIF Status</p>
              </div>
              <span className={`inline-flex px-2 py-1 text-sm rounded-full ${
                getStatusColor(staff.saCompliance?.uifStatus || '', 'uif')
              }`}>
                {staff.saCompliance?.uifStatus
                  ? UIF_STATUS_LABELS[staff.saCompliance.uifStatus as UIFStatus]
                  : 'Not Set'}
              </span>
              {staff.saCompliance?.uifNumber && (
                <p className="text-xs text-[var(--ff-text-secondary)] mt-2 font-mono">
                  UIF#: {staff.saCompliance.uifNumber}
                </p>
              )}
            </div>

            {/* COIDA Status */}
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileCheck className="w-5 h-5 text-[var(--ff-text-muted)]" />
                <p className="text-sm text-[var(--ff-text-secondary)]">COIDA Status</p>
              </div>
              <span className={`inline-flex px-2 py-1 text-sm rounded-full ${
                getStatusColor(staff.saCompliance?.coidaStatus || '', 'coida')
              }`}>
                {staff.saCompliance?.coidaStatus
                  ? COIDA_STATUS_LABELS[staff.saCompliance.coidaStatus as COIDAStatus]
                  : 'Not Set'}
              </span>
            </div>

            {/* Tax Status */}
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Receipt className="w-5 h-5 text-[var(--ff-text-muted)]" />
                <p className="text-sm text-[var(--ff-text-secondary)]">Tax Status</p>
              </div>
              <span className={`inline-flex px-2 py-1 text-sm rounded-full ${
                getStatusColor(staff.saCompliance?.taxStatus || '', 'tax')
              }`}>
                {staff.saCompliance?.taxStatus
                  ? TAX_STATUS_LABELS[staff.saCompliance.taxStatus as TaxStatus]
                  : 'PAYE'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Independent Contractor Notice */}
      {!isEmployee && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-purple-400 mt-0.5" />
            <div>
              <p className="font-medium text-purple-400">Independent Contractor</p>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                As an independent contractor, this person is responsible for their own:
              </p>
              <ul className="text-sm text-[var(--ff-text-secondary)] mt-2 list-disc list-inside">
                <li>Tax registration and provisional tax payments</li>
                <li>Personal insurance and liability cover</li>
                <li>UIF contributions (optional)</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Tax Information */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Tax Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Tax Reference Number</p>
            <p className="font-medium text-[var(--ff-text-primary)] font-mono">
              {staff.taxNumber || 'Not provided'}
            </p>
          </div>

          {onUploadDocument && (
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Tax Documents</p>
                <p className="text-xs text-[var(--ff-text-muted)]">IRP5, IT3a, Tax Clearance</p>
              </div>
              <button
                onClick={() => onUploadDocument('tax_document')}
                className="px-3 py-1.5 text-sm text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-lg hover:bg-blue-500/10"
              >
                Upload
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bank Details */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Bank Details</h2>
          {staff.bankDetailsVerifiedAt && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
              <BadgeCheck className="w-3 h-3" />
              Verified
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Bank Name */}
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Bank</p>
                <p className={`font-medium ${staff.bankName ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-muted)]'}`}>
                  {staff.bankName || 'Not provided'}
                </p>
              </div>
            </div>
          </div>

          {/* Account Number */}
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <div className="flex items-center gap-3">
              <CreditCard className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Account Number</p>
                <p className={`font-medium font-mono ${staff.bankAccountNumber ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-muted)]'}`}>
                  {staff.bankAccountNumber || 'Not provided'}
                </p>
              </div>
            </div>
          </div>

          {/* Branch Code */}
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Branch Code</p>
                <p className={`font-medium font-mono ${staff.bankBranchCode ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-muted)]'}`}>
                  {staff.bankBranchCode || 'Not provided'}
                </p>
              </div>
            </div>
          </div>

          {/* Account Type */}
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Briefcase className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Account Type</p>
                <p className={`font-medium capitalize ${staff.bankAccountType ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-muted)]'}`}>
                  {staff.bankAccountType || 'Not provided'}
                </p>
              </div>
            </div>
          </div>

          {/* Account Holder */}
          {staff.bankAccountHolder && (
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-[var(--ff-text-muted)]" />
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Account Holder</p>
                  <p className="font-medium text-[var(--ff-text-primary)]">{staff.bankAccountHolder}</p>
                </div>
              </div>
            </div>
          )}

          {/* Verification Date */}
          {staff.bankDetailsVerifiedAt && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-400" />
                <div>
                  <p className="text-sm text-green-400">Verified From Document</p>
                  <p className="font-medium text-green-300">{formatDate(staff.bankDetailsVerifiedAt)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {onUploadDocument && !staff.bankDetailsVerifiedAt && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => onUploadDocument('bank_details')}
              className="px-4 py-2 text-sm text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-lg hover:bg-blue-500/10"
            >
              Upload Bank Confirmation Letter
            </button>
          </div>
        )}
      </div>

      {/* Document Compliance Status */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Document Compliance</h2>
          {complianceStatus && (
            <div className="flex items-center gap-2">
              {complianceStatus.isCompliant ? (
                <span className="flex items-center gap-1.5 px-3 py-1 text-sm rounded-full bg-green-500/20 text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Fully Compliant
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1 text-sm rounded-full bg-yellow-500/20 text-yellow-400">
                  <AlertTriangle className="w-4 h-4" />
                  {complianceStatus.requiredComplete}/{complianceStatus.requiredTotal} Required
                </span>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" />
          </div>
        ) : complianceStatus ? (
          <div className="space-y-3">
            {/* Required Documents */}
            <div className="mb-4">
              <p className="text-sm text-[var(--ff-text-secondary)] mb-2 font-medium">Required Documents</p>
              <div className="space-y-2">
                {complianceStatus.documents.filter(d => d.required).map((doc) => (
                  <DocumentStatusRow
                    key={doc.type}
                    doc={doc}
                    onUpload={onUploadDocument ? () => onUploadDocument(doc.type) : undefined}
                  />
                ))}
              </div>
            </div>

            {/* Optional Documents */}
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)] mb-2 font-medium">Optional Documents</p>
              <div className="space-y-2">
                {complianceStatus.documents.filter(d => !d.required).map((doc) => (
                  <DocumentStatusRow
                    key={doc.type}
                    doc={doc}
                    onUpload={onUploadDocument ? () => onUploadDocument(doc.type) : undefined}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[var(--ff-text-secondary)]">Unable to load compliance status</p>
        )}
      </div>

      {/* Statutory Compliance Checklist - Only for Employees */}
      {isEmployee && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Statutory Compliance</h2>
          <div className="space-y-2">
            {[
              { label: 'UIF Registered', done: staff.saCompliance?.uifStatus === UIFStatus.REGISTERED },
              { label: 'COIDA Coverage', done: staff.saCompliance?.coidaStatus === COIDAStatus.COVERED },
              { label: 'Tax Number Provided', done: !!staff.taxNumber },
              { label: 'Bank Details Provided', done: !!staff.bankAccountNumber },
            ].map((item) => (
              <div
                key={item.label}
                className={`flex items-center gap-3 p-3 rounded-lg ${
                  item.done ? 'bg-green-500/10' : 'bg-yellow-500/10'
                }`}
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                  item.done ? 'bg-green-500' : 'bg-yellow-500'
                }`}>
                  {item.done ? (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <span className="text-xs text-white font-bold">!</span>
                  )}
                </div>
                <span className={item.done ? 'text-green-400' : 'text-yellow-400'}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Document Status Row Component
function DocumentStatusRow({
  doc,
  onUpload,
}: {
  doc: DocumentStatus;
  onUpload?: () => void;
}) {
  const getStatusBadge = () => {
    if (doc.expired) {
      return (
        <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
          <FileWarning className="w-3 h-3" />
          Expired
        </span>
      );
    }
    if (doc.verified) {
      return (
        <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400">
          <CheckCircle2 className="w-3 h-3" />
          Verified
        </span>
      );
    }
    if (doc.pending) {
      return (
        <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
          <Clock className="w-3 h-3" />
          Pending Review
        </span>
      );
    }
    if (doc.rejected) {
      return (
        <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
          <XCircle className="w-3 h-3" />
          Rejected
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-500/20 text-gray-400">
        Not Uploaded
      </span>
    );
  };

  const getBgColor = () => {
    if (doc.verified) return 'bg-green-500/5 border-green-500/20';
    if (doc.pending) return 'bg-yellow-500/5 border-yellow-500/20';
    if (doc.rejected || doc.expired) return 'bg-red-500/5 border-red-500/20';
    return 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]';
  };

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${getBgColor()}`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          doc.verified ? 'bg-green-500/20' :
          doc.pending ? 'bg-yellow-500/20' :
          doc.rejected || doc.expired ? 'bg-red-500/20' :
          'bg-gray-500/20'
        }`}>
          {doc.verified ? (
            <CheckCircle2 className="w-4 h-4 text-green-400" />
          ) : doc.pending ? (
            <Clock className="w-4 h-4 text-yellow-400" />
          ) : doc.rejected || doc.expired ? (
            <XCircle className="w-4 h-4 text-red-400" />
          ) : (
            <FileCheck className="w-4 h-4 text-gray-400" />
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">{doc.label}</p>
            {doc.required && (
              <span className="text-xs text-red-400">*</span>
            )}
          </div>
          {doc.documentNumber && (
            <p className="text-xs text-[var(--ff-text-secondary)] font-mono">#{doc.documentNumber}</p>
          )}
          {doc.expiryDate && (
            <p className="text-xs text-[var(--ff-text-secondary)]">
              Expires: {formatDisplayDate(doc.expiryDate)}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {getStatusBadge()}
        {onUpload && !doc.verified && (
          <button
            onClick={onUpload}
            className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg"
            title="Upload document"
          >
            <Upload className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
