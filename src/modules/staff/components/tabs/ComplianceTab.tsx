'use client';

import { Building2, Shield, Receipt, FileCheck, AlertTriangle } from 'lucide-react';
import type { StaffMember } from '@/types/staff';
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

interface ComplianceTabProps {
  staff: StaffMember;
  onUploadDocument?: (documentType: string) => void;
}

export function ComplianceTab({ staff, onUploadDocument }: ComplianceTabProps) {
  // Get contract config for dynamic field visibility
  const contractType = staff.saContractType as SAContractType | undefined;
  const contractConfig = contractType ? SA_CONTRACT_CONFIG[contractType] : null;
  const isEmployee = contractConfig?.isEmployee ?? true;

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
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Bank Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <p className="text-sm text-[var(--ff-text-secondary)]">Bank Name</p>
            </div>
            <p className="font-medium text-[var(--ff-text-primary)]">
              {staff.bankName || 'Not provided'}
            </p>
          </div>

          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Account Number</p>
            <p className="font-medium text-[var(--ff-text-primary)] font-mono">
              {staff.bankAccountNumber
                ? `****${staff.bankAccountNumber.slice(-4)}`
                : 'Not provided'}
            </p>
          </div>

          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Branch Code</p>
            <p className="font-medium text-[var(--ff-text-primary)] font-mono">
              {staff.bankBranchCode || 'Not provided'}
            </p>
          </div>

          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Account Type</p>
            <p className="font-medium text-[var(--ff-text-primary)]">
              {staff.bankAccountType
                ? staff.bankAccountType.charAt(0).toUpperCase() + staff.bankAccountType.slice(1)
                : 'Not specified'}
            </p>
          </div>
        </div>

        {onUploadDocument && (
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

      {/* Compliance Checklist */}
      {isEmployee && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Compliance Checklist</h2>
          <div className="space-y-2">
            {[
              { label: 'UIF Registered', done: staff.saCompliance?.uifStatus === UIFStatus.REGISTERED },
              { label: 'COIDA Coverage', done: staff.saCompliance?.coidaStatus === COIDAStatus.COVERED },
              { label: 'Tax Number Provided', done: !!staff.taxNumber },
              { label: 'Bank Details Provided', done: !!staff.bankAccountNumber },
              { label: 'ID Document Verified', done: staff.complianceComplete },
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
