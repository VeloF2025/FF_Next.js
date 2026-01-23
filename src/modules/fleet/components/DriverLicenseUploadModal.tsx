'use client';

/**
 * Driver's License Upload Modal for Fleet Module
 *
 * Allows Fleet managers to upload driver's licenses for staff members.
 * Uses the shared document upload wizard with OCR.
 * Activity is logged to the Staff side via staffAuditService.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Upload, Loader2, Search, User, FileText, AlertCircle } from 'lucide-react';
import { DocumentUploadWizard } from '@/components/shared/DocumentUploadWizard';

interface AvailableDriver {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  hasValidLicense: boolean;
  licenseExpiry: string | null;
  hasVehicle: boolean;
  currentVehicleReg: string | null;
}

interface DriverLicenseUploadModalProps {
  /** Pre-selected staff ID (optional - if not provided, shows search) */
  staffId?: string;
  /** Pre-selected staff name (for display) */
  staffName?: string;
  /** Called on successful upload */
  onSuccess: () => void;
  /** Called when modal is closed */
  onClose: () => void;
}

export function DriverLicenseUploadModal({
  staffId: preSelectedStaffId,
  staffName: preSelectedStaffName,
  onSuccess,
  onClose,
}: DriverLicenseUploadModalProps) {
  // State for staff selection (when no pre-selected staff)
  const [showStaffSearch, setShowStaffSearch] = useState(!preSelectedStaffId);
  const [searchQuery, setSearchQuery] = useState('');
  const [availableStaff, setAvailableStaff] = useState<AvailableDriver[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<{
    id: string;
    name: string;
  } | null>(
    preSelectedStaffId && preSelectedStaffName
      ? { id: preSelectedStaffId, name: preSelectedStaffName }
      : null
  );

  // Fetch available staff for search
  useEffect(() => {
    if (!showStaffSearch) return;

    async function fetchStaff() {
      setLoadingStaff(true);
      try {
        const res = await fetch('/api/fleet/available-drivers');
        if (!res.ok) throw new Error('Failed to fetch staff');
        const data = await res.json();
        setAvailableStaff(data.data.drivers);
      } catch (error) {
        console.error('Failed to fetch staff:', error);
      } finally {
        setLoadingStaff(false);
      }
    }

    fetchStaff();
  }, [showStaffSearch]);

  // Filter staff based on search query
  const filteredStaff = availableStaff.filter((staff) =>
    staff.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (staff.department && staff.department.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (staff.email && staff.email.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Handle staff selection
  const handleSelectStaff = useCallback((staff: AvailableDriver) => {
    setSelectedStaff({ id: staff.id, name: staff.name });
    setShowStaffSearch(false);
  }, []);

  // Handle successful upload
  const handleUploadSuccess = useCallback(() => {
    onSuccess();
    onClose();
  }, [onSuccess, onClose]);

  // Handle cancel - go back to search if no pre-selected staff
  const handleCancel = useCallback(() => {
    if (!preSelectedStaffId && selectedStaff) {
      setSelectedStaff(null);
      setShowStaffSearch(true);
    } else {
      onClose();
    }
  }, [preSelectedStaffId, selectedStaff, onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[var(--ff-border-light)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <FileText className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                Upload Driver&apos;s License
              </h3>
              {selectedStaff && (
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  For: {selectedStaff.name}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {showStaffSearch ? (
            // Staff Search View
            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Search for Staff Member
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, department, or email..."
                    className="w-full pl-10 pr-4 py-2.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-[var(--ff-primary)]"
                  />
                </div>
              </div>

              {loadingStaff ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-[var(--ff-text-tertiary)] animate-spin" />
                </div>
              ) : filteredStaff.length === 0 ? (
                <div className="text-center py-12">
                  <User className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
                  <p className="text-[var(--ff-text-secondary)]">
                    {searchQuery ? 'No staff found matching your search' : 'No active staff available'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {filteredStaff.map((staff) => (
                    <button
                      key={staff.id}
                      onClick={() => handleSelectStaff(staff)}
                      className="w-full p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-[var(--ff-primary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-[var(--ff-bg-tertiary)] rounded-full flex items-center justify-center">
                            <User className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
                          </div>
                          <div>
                            <p className="font-medium text-[var(--ff-text-primary)]">
                              {staff.name}
                            </p>
                            <p className="text-sm text-[var(--ff-text-secondary)]">
                              {staff.department || 'No department'} • {staff.email || 'No email'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {staff.hasValidLicense ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/10 text-green-500 rounded text-xs font-medium">
                              ✓ Has License
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-500/10 text-amber-500 rounded text-xs font-medium">
                              <AlertCircle className="w-3 h-3" />
                              No License
                            </span>
                          )}
                          {staff.licenseExpiry && (
                            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                              Expires: {new Date(staff.licenseExpiry).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : selectedStaff ? (
            // Document Upload Wizard
            <div className="p-6">
              <DocumentUploadWizard
                staffId={selectedStaff.id}
                context="fleet"
                onSuccess={handleUploadSuccess}
                onCancel={handleCancel}
              />
            </div>
          ) : null}
        </div>

        {/* Footer - only show for staff search */}
        {showStaffSearch && (
          <div className="p-4 border-t border-[var(--ff-border-light)] flex items-center justify-end shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-primary)]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
