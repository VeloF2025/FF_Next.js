'use client';

/**
 * Generate Agreement Modal
 * Shows contractor details and allows date configuration before generating
 * the Master Build Agreement DOCX.
 */

import { useState, useEffect } from 'react';
import { X, FileDown, Loader2, AlertTriangle, Building2, User, Mail, Phone, MapPin } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';

interface GenerateAgreementModalProps {
  contractorId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ContractorPreview {
  companyName: string;
  registrationNumber: string;
  contactPerson: string;
  email: string;
  phone: string;
  physicalAddress: string;
  city: string;
  province: string;
  postalCode: string;
}

export function GenerateAgreementModal({ contractorId, onClose, onSuccess }: GenerateAgreementModalProps) {
  const [contractor, setContractor] = useState<ContractorPreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const [agreementDate, setAgreementDate] = useState(today);
  const [effectiveDate, setEffectiveDate] = useState(today);

  // Fetch contractor data on mount
  useEffect(() => {
    async function fetchContractor() {
      try {
        const response = await fetch(`/api/contractors-detail?id=${contractorId}`);
        if (!response.ok) throw new Error('Failed to load contractor');

        const data = await response.json();
        const c = data.data || data;

        setContractor({
          companyName: c.companyName || c.company_name || '',
          registrationNumber: c.registrationNumber || c.registration_number || '',
          contactPerson: c.contactPerson || c.contact_person || '',
          email: c.email || '',
          phone: c.phone || '',
          physicalAddress: c.physicalAddress || c.physical_address || '',
          city: c.city || '',
          province: c.province || '',
          postalCode: c.postalCode || c.postal_code || '',
        });
      } catch (err) {
        log.error('Failed to fetch contractor for agreement', { error: err, contractorId }, 'GenerateAgreementModal');
        setError('Failed to load contractor details');
      } finally {
        setIsLoading(false);
      }
    }

    fetchContractor();
  }, [contractorId]);

  // Build full address string
  const fullAddress = contractor
    ? [contractor.physicalAddress, contractor.city, contractor.province, contractor.postalCode]
        .filter(Boolean)
        .join(', ')
    : '';

  // Check for missing fields
  const missingFields: string[] = [];
  if (contractor) {
    if (!contractor.companyName) missingFields.push('Company Name');
    if (!contractor.registrationNumber) missingFields.push('Registration Number');
    if (!contractor.contactPerson) missingFields.push('Contact Person');
    if (!contractor.email) missingFields.push('Email');
    if (!contractor.phone) missingFields.push('Phone');
    if (!fullAddress) missingFields.push('Physical Address');
  }

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/documents/generate-master-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractorId,
          agreementDate,
          effectiveDate,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate document');
      }

      // Get filename from content-disposition header
      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] || 'master-build-agreement.docx';

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      notificationService.success('Master Build Agreement generated');
      onSuccess?.();
      onClose();
    } catch (err) {
      log.error('Failed to generate agreement', { error: err, contractorId }, 'GenerateAgreementModal');
      const message = err instanceof Error ? err.message : 'Failed to generate document';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--ff-border-light)]">
          <div>
            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Generate Master Build Agreement</h2>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Review details before generating the agreement document
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
            disabled={isGenerating}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
              <span className="ml-3 text-[var(--ff-text-secondary)]">Loading contractor details...</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Error</p>
                <p className="text-sm text-red-400/80 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Contractor Details */}
          {contractor && !isLoading && (
            <>
              {/* Missing Fields Warning */}
              {missingFields.length > 0 && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-yellow-400">Missing Information</p>
                    <p className="text-sm text-yellow-400/80 mt-1">
                      The following fields are empty and will be blank in the agreement:
                      {' '}{missingFields.join(', ')}
                    </p>
                  </div>
                </div>
              )}

              {/* Contractor Info Card */}
              <div className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-5">
                <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4">
                  Contractor Details
                </h3>
                <div className="space-y-3">
                  <DetailRow icon={Building2} label="Company" value={contractor.companyName} />
                  <DetailRow icon={Building2} label="Reg. Number" value={contractor.registrationNumber} />
                  <DetailRow icon={User} label="Contact Person" value={contractor.contactPerson} />
                  <DetailRow icon={Mail} label="Email" value={contractor.email} />
                  <DetailRow icon={Phone} label="Phone" value={contractor.phone} />
                  <DetailRow icon={MapPin} label="Address" value={fullAddress} />
                </div>
              </div>

              {/* Agreement Dates */}
              <div className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-5">
                <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4">
                  Agreement Dates
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                      Agreement Date
                    </label>
                    <input
                      type="date"
                      value={agreementDate}
                      onChange={(e) => setAgreementDate(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={isGenerating}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                      Effective Date
                    </label>
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={isGenerating}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-[var(--ff-border-light)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isLoading || isGenerating || !contractor}
            className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                Generate Agreement
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Detail row with icon */
function DetailRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 text-[var(--ff-text-tertiary)] mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs text-[var(--ff-text-tertiary)]">{label}</span>
        <p className={`text-sm ${value ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-tertiary)] italic'}`}>
          {value || 'Not provided'}
        </p>
      </div>
    </div>
  );
}
