/**
 * Fleet Drivers Documents Tab
 * Manage driver's licenses from Fleet - upload, view, verify
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  User,
  FileText,
  Search,
  Upload,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Shield,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DriverLicenseUploadModal } from '../DriverLicenseUploadModal';
import { DocumentVerificationModal } from '@/components/shared/DocumentVerificationModal';
import { log } from '@/lib/logger';
import { formatDisplayDate } from '@/utils/dateFormat';

interface DriverDocument {
  staffId: string;
  staffName: string;
  department: string | null;
  photoUrl: string | null;
  // Document info
  documentId: string | null;
  documentStatus: 'verified' | 'pending' | 'rejected' | 'missing' | null;
  licenseExpiry: string | null;
  licenseStatus: 'valid' | 'expiring' | 'expired' | 'missing';
  uploadedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

interface DriversDocumentsTabProps {
  /** Callback to refresh parent data */
  onRefresh?: () => void;
}

type FilterStatus = 'all' | 'valid' | 'expiring' | 'expired' | 'missing' | 'pending';

function getLicenseStatusColor(status: DriverDocument['licenseStatus']): string {
  switch (status) {
    case 'valid':
      return 'text-green-500';
    case 'expiring':
      return 'text-yellow-500';
    case 'expired':
      return 'text-red-500';
    default:
      return 'text-gray-400';
  }
}

function LicenseStatusIcon({ status }: { status: DriverDocument['licenseStatus'] }) {
  switch (status) {
    case 'valid':
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case 'expiring':
      return <Clock className="w-4 h-4 text-yellow-500" />;
    case 'expired':
      return <XCircle className="w-4 h-4 text-red-500" />;
    default:
      return <AlertTriangle className="w-4 h-4 text-gray-400" />;
  }
}

function DocumentStatusBadge({ status }: { status: DriverDocument['documentStatus'] }) {
  if (!status || status === 'missing') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-500/10 text-gray-400 rounded text-xs">
        <AlertTriangle className="w-3 h-3" />
        Not Uploaded
      </span>
    );
  }

  switch (status) {
    case 'verified':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-500/10 text-green-500 rounded text-xs">
          <CheckCircle className="w-3 h-3" />
          Verified
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-500 rounded text-xs">
          <Clock className="w-3 h-3" />
          Pending
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-500 rounded text-xs">
          <XCircle className="w-3 h-3" />
          Rejected
        </span>
      );
    default:
      return null;
  }
}

export function DriversDocumentsTab({ onRefresh }: DriversDocumentsTabProps) {
  const [drivers, setDrivers] = useState<DriverDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<{ id: string; name: string } | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<DriverDocument | null>(null);

  // Fetch drivers with document status
  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/fleet/drivers-documents');
      if (!res.ok) throw new Error('Failed to fetch drivers');
      const data = await res.json();
      setDrivers(data.data.drivers);
    } catch (error) {
      log.error('Failed to fetch drivers documents', { error }, 'DriversDocumentsTab');
      toast.error('Failed to load drivers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  // Filter drivers
  const filteredDrivers = useMemo(() => {
    return drivers.filter((driver) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          driver.staffName.toLowerCase().includes(query) ||
          (driver.department && driver.department.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      // Status filter
      if (filterStatus !== 'all') {
        if (filterStatus === 'pending') {
          return driver.documentStatus === 'pending';
        }
        return driver.licenseStatus === filterStatus;
      }

      return true;
    });
  }, [drivers, searchQuery, filterStatus]);

  // Summary stats
  const stats = useMemo(() => {
    return {
      total: drivers.length,
      valid: drivers.filter((d) => d.licenseStatus === 'valid').length,
      expiring: drivers.filter((d) => d.licenseStatus === 'expiring').length,
      expired: drivers.filter((d) => d.licenseStatus === 'expired').length,
      missing: drivers.filter((d) => d.licenseStatus === 'missing').length,
      pending: drivers.filter((d) => d.documentStatus === 'pending').length,
    };
  }, [drivers]);

  // Handle upload
  const handleUpload = useCallback((driver: DriverDocument) => {
    setUploadTarget({ id: driver.staffId, name: driver.staffName });
    setShowUploadModal(true);
  }, []);

  // Handle upload for new staff
  const handleUploadNew = useCallback(() => {
    setUploadTarget(null);
    setShowUploadModal(true);
  }, []);

  // Handle upload success
  const handleUploadSuccess = useCallback(() => {
    setShowUploadModal(false);
    setUploadTarget(null);
    fetchDrivers();
    onRefresh?.();
    toast.success('Driver\'s license uploaded successfully');
  }, [fetchDrivers, onRefresh]);

  // Handle verify
  const handleVerify = useCallback((driver: DriverDocument) => {
    setVerifyTarget(driver);
    setShowVerifyModal(true);
  }, []);

  // Handle verify success
  const handleVerifySuccess = useCallback(() => {
    setShowVerifyModal(false);
    setVerifyTarget(null);
    fetchDrivers();
    onRefresh?.();
    toast.success('Document verified successfully');
  }, [fetchDrivers, onRefresh]);

  // Handle view document
  const handleViewDocument = useCallback((driver: DriverDocument) => {
    if (!driver.documentId) return;
    window.open(`/staff/${driver.staffId}/documents`, '_blank');
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" label="" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <button
          onClick={() => setFilterStatus('all')}
          className={`p-4 rounded-lg border transition-colors ${
            filterStatus === 'all'
              ? 'border-[var(--ff-primary)] bg-[var(--ff-primary)]/5'
              : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-[var(--ff-border-medium)]'
          }`}
        >
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.total}</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Total Drivers</p>
        </button>
        <button
          onClick={() => setFilterStatus('valid')}
          className={`p-4 rounded-lg border transition-colors ${
            filterStatus === 'valid'
              ? 'border-green-500 bg-green-500/5'
              : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-green-500/50'
          }`}
        >
          <p className="text-2xl font-bold text-green-500">{stats.valid}</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Valid</p>
        </button>
        <button
          onClick={() => setFilterStatus('expiring')}
          className={`p-4 rounded-lg border transition-colors ${
            filterStatus === 'expiring'
              ? 'border-yellow-500 bg-yellow-500/5'
              : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-yellow-500/50'
          }`}
        >
          <p className="text-2xl font-bold text-yellow-500">{stats.expiring}</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Expiring</p>
        </button>
        <button
          onClick={() => setFilterStatus('expired')}
          className={`p-4 rounded-lg border transition-colors ${
            filterStatus === 'expired'
              ? 'border-red-500 bg-red-500/5'
              : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-red-500/50'
          }`}
        >
          <p className="text-2xl font-bold text-red-500">{stats.expired}</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Expired</p>
        </button>
        <button
          onClick={() => setFilterStatus('missing')}
          className={`p-4 rounded-lg border transition-colors ${
            filterStatus === 'missing'
              ? 'border-gray-500 bg-gray-500/5'
              : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-gray-500/50'
          }`}
        >
          <p className="text-2xl font-bold text-gray-400">{stats.missing}</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Missing</p>
        </button>
        <button
          onClick={() => setFilterStatus('pending')}
          className={`p-4 rounded-lg border transition-colors ${
            filterStatus === 'pending'
              ? 'border-amber-500 bg-amber-500/5'
              : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-amber-500/50'
          }`}
        >
          <p className="text-2xl font-bold text-amber-500">{stats.pending}</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">Pending Review</p>
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or department..."
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={handleUploadNew}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload License
        </button>
      </div>

      {/* Drivers Table */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  Driver
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  License Status
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  Document Status
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  Expiry Date
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <FileText className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
                    <p className="text-[var(--ff-text-secondary)]">
                      {searchQuery || filterStatus !== 'all'
                        ? 'No drivers match your filters'
                        : 'No drivers found'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredDrivers.map((driver) => (
                  <tr
                    key={driver.staffId}
                    className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                  >
                    {/* Driver */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {driver.photoUrl ? (
                          <img
                            src={driver.photoUrl}
                            alt={driver.staffName}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[var(--ff-primary)] flex items-center justify-center">
                            <User className="w-5 h-5 text-white" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-[var(--ff-text-primary)]">
                            {driver.staffName}
                          </p>
                          <p className="text-xs text-[var(--ff-text-tertiary)]">
                            {driver.department || 'No department'}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* License Status */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <LicenseStatusIcon status={driver.licenseStatus} />
                        <span className={`text-sm font-medium ${getLicenseStatusColor(driver.licenseStatus)}`}>
                          {driver.licenseStatus === 'valid' && 'Valid'}
                          {driver.licenseStatus === 'expiring' && 'Expiring Soon'}
                          {driver.licenseStatus === 'expired' && 'Expired'}
                          {driver.licenseStatus === 'missing' && 'Missing'}
                        </span>
                      </div>
                    </td>

                    {/* Document Status */}
                    <td className="py-3 px-4">
                      <DocumentStatusBadge status={driver.documentStatus} />
                    </td>

                    {/* Expiry Date */}
                    <td className="py-3 px-4">
                      {driver.licenseExpiry ? (
                        <span className="text-sm text-[var(--ff-text-primary)]">
                          {formatDisplayDate(driver.licenseExpiry)}
                        </span>
                      ) : (
                        <span className="text-sm text-[var(--ff-text-tertiary)]">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        {driver.documentStatus === 'pending' && (
                          <button
                            onClick={() => handleVerify(driver)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/10 text-amber-500 rounded-lg hover:bg-amber-500/20 transition-colors text-sm"
                            title="Verify document"
                          >
                            <Shield className="w-4 h-4" />
                            Verify
                          </button>
                        )}
                        {driver.documentId && driver.documentStatus !== 'pending' && (
                          <button
                            onClick={() => handleViewDocument(driver)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded-lg hover:bg-[var(--ff-bg-primary)] transition-colors text-sm"
                            title="View in Staff"
                          >
                            <ExternalLink className="w-4 h-4" />
                            View
                          </button>
                        )}
                        <button
                          onClick={() => handleUpload(driver)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-[var(--ff-primary)]/10 text-[var(--ff-primary)] rounded-lg hover:bg-[var(--ff-primary)]/20 transition-colors text-sm"
                          title={driver.documentId ? 'Upload new version' : 'Upload license'}
                        >
                          <Upload className="w-4 h-4" />
                          {driver.documentId ? 'Replace' : 'Upload'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <DriverLicenseUploadModal
          staffId={uploadTarget?.id}
          staffName={uploadTarget?.name}
          onSuccess={handleUploadSuccess}
          onClose={() => {
            setShowUploadModal(false);
            setUploadTarget(null);
          }}
        />
      )}

      {/* Verify Modal */}
      {showVerifyModal && verifyTarget && verifyTarget.documentId && (
        <DocumentVerificationModal
          documentId={verifyTarget.documentId}
          staffId={verifyTarget.staffId}
          staffName={verifyTarget.staffName}
          onSuccess={handleVerifySuccess}
          onClose={() => {
            setShowVerifyModal(false);
            setVerifyTarget(null);
          }}
        />
      )}
    </div>
  );
}
