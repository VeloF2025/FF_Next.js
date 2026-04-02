'use client';

import { Info, Building2 } from 'lucide-react';
import { StaffFormData } from '@/types/staff.types';
import {
  SAContractType,
  SA_CONTRACT_CONFIG,
  SA_CONTRACT_TYPE_LABELS,
  UIFStatus,
  UIF_STATUS_LABELS,
  COIDAStatus,
  COIDA_STATUS_LABELS,
  TaxStatus,
  TAX_STATUS_LABELS,
} from '@/types/staff/compliance.types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ComplianceEditSectionProps {
  formData: StaffFormData;
  handleInputChange: (field: keyof StaffFormData, value: unknown) => void;
}

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-[var(--ff-text-secondary)]";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-secondary)] mb-1";
const selectTriggerClasses = "w-full h-10 px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

export function ComplianceEditSection({ formData, handleInputChange }: ComplianceEditSectionProps) {
  const contractType = (formData.saContractType || formData.contractType) as SAContractType;
  const config = contractType ? SA_CONTRACT_CONFIG[contractType] : null;
  const isEmployee = config?.isEmployee ?? true;

  return (
    <div className="space-y-8">
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
        {config && (
          <p className="text-sm text-[var(--ff-text-secondary)] mt-2">{config.description}</p>
        )}
      </div>

      {/* Independent Contractor Notice */}
      {!isEmployee && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-purple-400 mt-0.5" />
            <div>
              <p className="font-medium text-purple-400">Independent Contractor</p>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                As an independent contractor, this person is responsible for their own tax, UIF, and insurance obligations.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Statutory Compliance - Only for Employees */}
      {isEmployee && config && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Statutory Compliance</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* UIF Section */}
            {config.requiresUIF && (
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <label className={labelClasses}>UIF Status *</label>
                <Select
                  value={formData.uifStatus || UIFStatus.PENDING}
                  onValueChange={(value) => handleInputChange('uifStatus', value as UIFStatus)}
                >
                  <SelectTrigger className={selectTriggerClasses}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(UIFStatus)
                      .filter(s => s !== UIFStatus.NOT_APPLICABLE)
                      .map(status => (
                        <SelectItem key={status} value={status}>
                          {UIF_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {formData.uifStatus === UIFStatus.REGISTERED && (
                  <div className="mt-3">
                    <label className={labelClasses}>UIF Number</label>
                    <input
                      type="text"
                      value={formData.uifNumber || ''}
                      onChange={(e) => handleInputChange('uifNumber', e.target.value)}
                      className={inputClasses}
                      placeholder="UIF reference number"
                    />
                  </div>
                )}
              </div>
            )}

            {/* COIDA Section */}
            {config.requiresCOIDA && (
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <label className={labelClasses}>COIDA Status *</label>
                <Select
                  value={formData.coidaStatus || COIDAStatus.PENDING}
                  onValueChange={(value) => handleInputChange('coidaStatus', value as COIDAStatus)}
                >
                  <SelectTrigger className={selectTriggerClasses}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(COIDAStatus)
                      .filter(s => s !== COIDAStatus.NOT_APPLICABLE)
                      .map(status => (
                        <SelectItem key={status} value={status}>
                          {COIDA_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Tax Status */}
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <label className={labelClasses}>Tax Status *</label>
              <Select
                value={formData.taxStatus || (config?.requiresPAYE ? TaxStatus.PAYE : TaxStatus.PROVISIONAL)}
                onValueChange={(value) => handleInputChange('taxStatus', value as TaxStatus)}
              >
                <SelectTrigger className={selectTriggerClasses}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(TaxStatus).map(status => (
                    <SelectItem key={status} value={status}>
                      {TAX_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Tax Information */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Tax Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Tax Reference Number</label>
            <input
              type="text"
              value={formData.taxNumber || ''}
              onChange={(e) => handleInputChange('taxNumber', e.target.value)}
              className={inputClasses}
              placeholder="SARS Tax Reference Number"
            />
          </div>

          <div>
            <label className={labelClasses}>SA ID Number (for Tax)</label>
            <input
              type="text"
              maxLength={13}
              value={formData.idNumber || ''}
              onChange={(e) => handleInputChange('idNumber', e.target.value.replace(/\D/g, ''))}
              className={inputClasses}
              placeholder="13-digit SA ID"
            />
          </div>
        </div>
      </div>

      {/* Work Permit (for foreign nationals) */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Work Permit (Foreign Nationals)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Work Permit Number</label>
            <input
              type="text"
              value={formData.workPermitNumber || ''}
              onChange={(e) => handleInputChange('workPermitNumber', e.target.value)}
              className={inputClasses}
              placeholder="Work permit number"
            />
          </div>

          {formData.workPermitNumber && (
            <div>
              <label className={labelClasses}>Work Permit Expiry</label>
              <input
                type="date"
                value={formData.workPermitExpiry instanceof Date ? formData.workPermitExpiry.toISOString().split('T')[0] : ''}
                onChange={(e) => handleInputChange('workPermitExpiry', e.target.value ? new Date(e.target.value) : undefined)}
                className={inputClasses}
              />
            </div>
          )}
        </div>
      </div>

      {/* Bank Details */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Bank Details</h2>
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-5 h-5 text-[var(--ff-text-muted)]" />
            <span className="text-sm text-[var(--ff-text-secondary)]">For salary payments</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClasses}>Bank Name</label>
              <select
                value={formData.bankName || ''}
                onChange={(e) => handleInputChange('bankName', e.target.value)}
                className={inputClasses}
              >
                <option value="">Select Bank</option>
                <option value="ABSA">ABSA</option>
                <option value="African Bank">African Bank</option>
                <option value="Capitec">Capitec</option>
                <option value="Discovery Bank">Discovery Bank</option>
                <option value="FNB">First National Bank (FNB)</option>
                <option value="Investec">Investec</option>
                <option value="Nedbank">Nedbank</option>
                <option value="Standard Bank">Standard Bank</option>
                <option value="TymeBank">TymeBank</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className={labelClasses}>Account Number</label>
              <input
                type="text"
                value={formData.bankAccountNumber || ''}
                onChange={(e) => handleInputChange('bankAccountNumber', e.target.value)}
                className={inputClasses}
                placeholder="Bank account number"
              />
            </div>

            <div>
              <label className={labelClasses}>Branch Code</label>
              <input
                type="text"
                value={formData.bankBranchCode || ''}
                onChange={(e) => handleInputChange('bankBranchCode', e.target.value)}
                className={inputClasses}
                placeholder="6-digit branch code"
              />
            </div>

            <div>
              <label className={labelClasses}>Account Type</label>
              <select
                value={formData.bankAccountType || ''}
                onChange={(e) => handleInputChange('bankAccountType', e.target.value)}
                className={inputClasses}
              >
                <option value="">Select Account Type</option>
                <option value="cheque">Cheque Account</option>
                <option value="savings">Savings Account</option>
                <option value="transmission">Transmission Account</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
