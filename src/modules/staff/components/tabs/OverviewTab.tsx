'use client';

import { Mail, Phone, MapPin, Calendar, FileText, Upload, Download, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { safeToDate } from '@/utils/dateHelpers';
import type { StaffMember } from '@/types/staff';
import { useState, useRef } from 'react';

interface OverviewTabProps {
  staff: StaffMember;
  onCvUpload?: (file: File) => Promise<void>;
  onCvDelete?: () => Promise<void>;
}

export function OverviewTab({ staff, onCvUpload, onCvDelete }: OverviewTabProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onCvUpload) return;

    setUploading(true);
    try {
      await onCvUpload(file);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-400';
      case 'on_leave': return 'bg-yellow-500/20 text-yellow-400';
      case 'inactive': return 'bg-gray-500/20 text-gray-400';
      case 'suspended': return 'bg-red-500/20 text-red-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  const formatDate = (date: unknown): string => {
    if (!date) return 'N/A';
    try {
      return format(safeToDate(date), 'dd MMM yyyy');
    } catch {
      return 'Invalid Date';
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Badge */}
      <div>
        <span className={`inline-flex px-3 py-1 text-sm font-medium rounded-full ${getStatusColor(staff.status)}`}>
          {staff.status?.replace('_', ' ').toUpperCase() || 'UNKNOWN'}
        </span>
      </div>

      {/* CV Section */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">CV / Resume</h2>
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
          {staff.cvUrl ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-blue-400" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">CV Uploaded</p>
                  {staff.cvUploadedAt && (
                    <p className="text-sm text-[var(--ff-text-secondary)]">
                      Uploaded {formatDate(staff.cvUploadedAt)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={staff.cvUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-blue-400 hover:text-blue-300"
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
                {onCvDelete && (
                  <button
                    onClick={onCvDelete}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remove
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <FileText className="w-12 h-12 text-[var(--ff-text-muted)] mx-auto mb-2" />
              <p className="text-[var(--ff-text-secondary)] mb-3">No CV uploaded</p>
              {onCvUpload && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" />
                    {uploading ? 'Uploading...' : 'Upload CV'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Contact Information */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Contact Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-[var(--ff-text-muted)]" />
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Email</p>
              <a href={`mailto:${staff.email}`} className="text-blue-400 hover:text-blue-300">
                {staff.email}
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Phone className="w-5 h-5 text-[var(--ff-text-muted)]" />
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Phone</p>
              <a href={`tel:${staff.phone}`} className="text-blue-400 hover:text-blue-300">
                {staff.phone}
              </a>
            </div>
          </div>

          {staff.alternativePhone && (
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Alternative Phone</p>
                <a href={`tel:${staff.alternativePhone}`} className="text-blue-400 hover:text-blue-300">
                  {staff.alternativePhone}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Address */}
      {staff.address && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Address</h2>
          <div className="flex items-start gap-3 bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <MapPin className="w-5 h-5 text-[var(--ff-text-muted)] mt-0.5" />
            <div>
              <p className="text-[var(--ff-text-primary)]">{staff.address}</p>
              <p className="text-[var(--ff-text-secondary)]">
                {[staff.city, staff.province, staff.postalCode].filter(Boolean).join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Contact */}
      {(staff.emergencyContactName || staff.emergencyContactPhone) && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Emergency Contact</h2>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            {staff.emergencyContactName && (
              <p className="font-medium text-[var(--ff-text-primary)]">{staff.emergencyContactName}</p>
            )}
            {staff.emergencyContactRelationship && (
              <p className="text-sm text-[var(--ff-text-secondary)]">{staff.emergencyContactRelationship}</p>
            )}
            {staff.emergencyContactPhone && (
              <a href={`tel:${staff.emergencyContactPhone}`} className="text-sm text-blue-400 hover:text-blue-300">
                {staff.emergencyContactPhone}
              </a>
            )}
          </div>
        </div>
      )}

      {/* Next of Kin */}
      {(staff.nextOfKinName || staff.nextOfKinPhone) && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Next of Kin</h2>
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            {staff.nextOfKinName && (
              <p className="font-medium text-[var(--ff-text-primary)]">{staff.nextOfKinName}</p>
            )}
            {staff.nextOfKinRelationship && (
              <p className="text-sm text-[var(--ff-text-secondary)]">{staff.nextOfKinRelationship}</p>
            )}
            {staff.nextOfKinPhone && (
              <a href={`tel:${staff.nextOfKinPhone}`} className="text-sm text-blue-400 hover:text-blue-300">
                {staff.nextOfKinPhone}
              </a>
            )}
            {staff.nextOfKinAddress && (
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">{staff.nextOfKinAddress}</p>
            )}
          </div>
        </div>
      )}

      {/* SA ID / Passport */}
      {(staff.saIdNumber || staff.passportNumber) && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Identity Documents</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {staff.saIdNumber && (
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <p className="text-sm text-[var(--ff-text-secondary)]">SA ID Number</p>
                <p className="font-medium text-[var(--ff-text-primary)] font-mono">{staff.saIdNumber}</p>
              </div>
            )}
            {staff.passportNumber && (
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <p className="text-sm text-[var(--ff-text-secondary)]">Passport Number</p>
                <p className="font-medium text-[var(--ff-text-primary)] font-mono">{staff.passportNumber}</p>
                {staff.passportCountry && (
                  <p className="text-xs text-[var(--ff-text-secondary)]">{staff.passportCountry}</p>
                )}
                {staff.passportExpiry && (
                  <p className="text-xs text-[var(--ff-text-secondary)]">
                    Expires: {formatDate(staff.passportExpiry)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
