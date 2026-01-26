'use client';

import { Mail, Phone, MapPin, FileText, Upload, Download, Trash2, Camera, User, RefreshCw, CheckCircle, AlertCircle, XCircle, Briefcase, Building2, BadgeCheck, Users, Locate, CalendarDays, CreditCard, Globe } from 'lucide-react';
import { format } from 'date-fns';
import { safeToDate } from '@/utils/dateHelpers';
import type { StaffMember } from '@/types/staff';
import { useState, useRef } from 'react';

interface OverviewTabProps {
  staff: StaffMember;
  onCvUpload?: (file: File) => Promise<void>;
  onCvDelete?: () => Promise<void>;
  onProfilePhotoUpload?: (file: File) => Promise<void>;
  onProfilePhotoDelete?: () => Promise<void>;
  onComparePhotos?: () => Promise<void>;
}

export function OverviewTab({ staff, onCvUpload, onCvDelete, onProfilePhotoUpload, onProfilePhotoDelete, onComparePhotos }: OverviewTabProps) {
  const [uploading, setUploading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

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

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onProfilePhotoUpload) return;

    setPhotoUploading(true);
    try {
      await onProfilePhotoUpload(file);
    } finally {
      setPhotoUploading(false);
      if (photoInputRef.current) {
        photoInputRef.current.value = '';
      }
    }
  };

  const handleComparePhotos = async () => {
    if (!onComparePhotos) return;
    setComparing(true);
    try {
      await onComparePhotos();
    } finally {
      setComparing(false);
    }
  };

  const getMatchScoreColor = (score: number | undefined) => {
    if (!score) return 'text-gray-400';
    if (score >= 80) return 'text-green-400';
    if (score >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getMatchScoreIcon = (score: number | undefined) => {
    if (!score) return null;
    if (score >= 80) return <CheckCircle className="w-5 h-5 text-green-400" />;
    if (score >= 50) return <AlertCircle className="w-5 h-5 text-yellow-400" />;
    return <XCircle className="w-5 h-5 text-red-400" />;
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

  const formatPosition = (position: string): string => {
    return position?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'N/A';
  };

  const formatDepartment = (department: string): string => {
    return department?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'N/A';
  };

  return (
    <div className="space-y-6">
      {/* Employment Details - TOP SECTION */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Employment Details</h2>
          <span className={`inline-flex px-3 py-1 text-sm font-medium rounded-full ${getStatusColor(staff.status)}`}>
            {staff.status?.replace('_', ' ').toUpperCase() || 'UNKNOWN'}
          </span>
        </div>
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Position */}
            <div className="flex items-center gap-3">
              <Briefcase className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Position</p>
                <p className="font-medium text-[var(--ff-text-primary)]">{formatPosition(staff.position as string)}</p>
              </div>
            </div>

            {/* Department */}
            <div className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Department</p>
                <p className="font-medium text-[var(--ff-text-primary)]">{formatDepartment(staff.department)}</p>
              </div>
            </div>

            {/* Employee ID */}
            <div className="flex items-center gap-3">
              <BadgeCheck className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Employee ID</p>
                <p className="font-medium text-[var(--ff-text-primary)] font-mono">{staff.employeeId || 'N/A'}</p>
              </div>
            </div>

            {/* Reports To */}
            {(staff.managerName || staff.reportsTo) && (
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-[var(--ff-text-muted)]" />
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Reports To</p>
                  <p className="font-medium text-[var(--ff-text-primary)]">{staff.managerName || staff.reportsTo}</p>
                </div>
              </div>
            )}

            {/* Work Location */}
            {staff.workLocation && (
              <div className="flex items-center gap-3">
                <Locate className="w-5 h-5 text-[var(--ff-text-muted)]" />
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Work Location</p>
                  <p className="font-medium text-[var(--ff-text-primary)]">{staff.workLocation}</p>
                </div>
              </div>
            )}

            {/* Start Date */}
            <div className="flex items-center gap-3">
              <CalendarDays className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Start Date</p>
                <p className="font-medium text-[var(--ff-text-primary)]">{formatDate(staff.startDate)}</p>
              </div>
            </div>
          </div>

          {/* Bio / Job Description */}
          {staff.bio && (
            <div className="mt-4 pt-4 border-t border-[var(--ff-border-primary)]">
              <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Bio / Job Description</p>
              <p className="text-[var(--ff-text-primary)]">{staff.bio}</p>
            </div>
          )}
        </div>
      </div>

      {/* Contact Information */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Contact Information</h2>
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

          {/* Address */}
          {staff.address && (
            <div className="mt-4 pt-4 border-t border-[var(--ff-border-primary)]">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-[var(--ff-text-muted)] mt-0.5" />
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Address</p>
                  <p className="text-[var(--ff-text-primary)]">{staff.address}</p>
                  <p className="text-[var(--ff-text-secondary)]">
                    {[staff.city, staff.province, staff.postalCode].filter(Boolean).join(', ')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Identity Documents - Always visible */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Identity Documents</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* SA ID */}
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <div className="flex items-center gap-3">
              <CreditCard className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">SA ID Number</p>
                <p className={`font-medium font-mono ${staff.saIdNumber ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-muted)]'}`}>
                  {staff.saIdNumber || 'Not provided'}
                </p>
              </div>
            </div>
          </div>

          {/* Passport */}
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Passport</p>
                {staff.passportNumber ? (
                  <>
                    <p className="font-medium text-[var(--ff-text-primary)] font-mono">{staff.passportNumber}</p>
                    {staff.passportCountry && (
                      <p className="text-xs text-[var(--ff-text-secondary)]">Country: {staff.passportCountry}</p>
                    )}
                    {staff.passportExpiry && (
                      <p className="text-xs text-[var(--ff-text-secondary)]">
                        Expires: {formatDate(staff.passportExpiry)}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="font-medium text-[var(--ff-text-muted)]">Not provided</p>
                )}
              </div>
            </div>
          </div>

          {/* Nationality */}
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Nationality</p>
                <p className={`font-medium ${staff.nationality ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-muted)]'}`}>
                  {staff.nationality || 'Not provided'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Emergency Contact */}
      {(staff.emergencyContactName || staff.emergencyContactPhone) && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Emergency Contact</h2>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 max-w-md">
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

      {/* Photo Verification Section - MIDDLE */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Photo Verification</h2>
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* ID Photo (from document) */}
            <div className="text-center">
              <p className="text-sm text-[var(--ff-text-secondary)] mb-2">ID Photo</p>
              <div className="w-32 h-40 mx-auto bg-[var(--ff-bg-secondary)] rounded-lg overflow-hidden border border-[var(--ff-border-primary)] flex items-center justify-center">
                {staff.idPhotoUrl ? (
                  <img
                    src={staff.idPhotoUrl}
                    alt="ID Photo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center p-4">
                    <User className="w-12 h-12 text-[var(--ff-text-muted)] mx-auto mb-2" />
                    <p className="text-xs text-[var(--ff-text-muted)]">No ID photo</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-[var(--ff-text-muted)] mt-2">
                {staff.idPhotoUrl ? 'Extracted from ID' : 'Upload SA ID or Passport'}
              </p>
            </div>

            {/* Profile Photo (manually uploaded) */}
            <div className="text-center">
              <p className="text-sm text-[var(--ff-text-secondary)] mb-2">Profile Photo</p>
              <div className="w-32 h-40 mx-auto bg-[var(--ff-bg-secondary)] rounded-lg overflow-hidden border border-[var(--ff-border-primary)] flex items-center justify-center relative group">
                {staff.profilePhotoUrl ? (
                  <>
                    <img
                      src={staff.profilePhotoUrl}
                      alt="Profile Photo"
                      className="w-full h-full object-cover"
                    />
                    {onProfilePhotoDelete && (
                      <button
                        onClick={onProfilePhotoDelete}
                        className="absolute top-1 right-1 p-1 bg-red-500/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove photo"
                      >
                        <Trash2 className="w-3 h-3 text-white" />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center p-4">
                    <Camera className="w-12 h-12 text-[var(--ff-text-muted)] mx-auto mb-2" />
                    <p className="text-xs text-[var(--ff-text-muted)]">No photo</p>
                  </div>
                )}
              </div>
              {onProfilePhotoUpload && (
                <div className="mt-2">
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoChange}
                    className="sr-only"
                    id="profile-photo-upload"
                  />
                  <label
                    htmlFor="profile-photo-upload"
                    className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer ${photoUploading ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <Upload className="w-3 h-3" />
                    {photoUploading ? 'Uploading...' : staff.profilePhotoUrl ? 'Change Photo' : 'Upload Photo'}
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Match Score and Compare Button */}
          {(staff.idPhotoUrl && staff.profilePhotoUrl) && (
            <div className="mt-4 pt-4 border-t border-[var(--ff-border-primary)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getMatchScoreIcon(staff.photoMatchScore)}
                  <span className="text-sm text-[var(--ff-text-secondary)]">Match Score:</span>
                  <span className={`text-lg font-bold ${getMatchScoreColor(staff.photoMatchScore)}`}>
                    {staff.photoMatchScore ? `${staff.photoMatchScore}%` : 'Not compared'}
                  </span>
                  {staff.photoVerifiedAt && (
                    <span className="text-xs text-[var(--ff-text-muted)]">
                      (Last checked: {formatDate(staff.photoVerifiedAt)})
                    </span>
                  )}
                </div>
                {onComparePhotos && (
                  <button
                    onClick={handleComparePhotos}
                    disabled={comparing}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${comparing ? 'animate-spin' : ''}`} />
                    {comparing ? 'Comparing...' : 'Compare Photos'}
                  </button>
                )}
              </div>
              {staff.photoMatchScore !== undefined && staff.photoMatchScore < 50 && (
                <p className="mt-2 text-xs text-red-400">
                  Warning: Low match score. Please verify this staff member&apos;s identity manually.
                </p>
              )}
            </div>
          )}

          {/* Help text when one photo is missing */}
          {(!staff.idPhotoUrl || !staff.profilePhotoUrl) && (
            <div className="mt-4 pt-4 border-t border-[var(--ff-border-primary)]">
              <p className="text-sm text-[var(--ff-text-muted)]">
                {!staff.idPhotoUrl && !staff.profilePhotoUrl && (
                  'Upload an SA ID or Passport in Documents tab to extract ID photo, then upload a profile photo to compare.'
                )}
                {staff.idPhotoUrl && !staff.profilePhotoUrl && (
                  'Upload a profile photo to compare against the ID photo.'
                )}
                {!staff.idPhotoUrl && staff.profilePhotoUrl && (
                  'Upload an SA ID or Passport in Documents tab to extract ID photo for comparison.'
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* CV / Resume Section - BOTTOM */}
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
    </div>
  );
}
