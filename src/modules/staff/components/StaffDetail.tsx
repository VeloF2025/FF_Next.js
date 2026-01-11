'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Edit, Mail, Phone, Calendar, Briefcase, Award, FileText, FolderKanban, User } from 'lucide-react';
import { useStaffMember, useDeleteStaff } from '@/hooks/useStaff';
import { format } from 'date-fns';
import { safeToDate } from '@/utils/dateHelpers';
import { log } from '@/lib/logger';
import { StaffDocumentList } from '@/components/staff/StaffDocumentList';
import { StaffProjectAssignment } from '@/components/staff/StaffProjectAssignment';

type TabType = 'overview' | 'documents' | 'projects';

export function StaffDetail() {
  const router = useRouter();
  const { id } = router.query as { id: string };
  const { data: staff, isLoading, error } = useStaffMember(id || '');
  const deleteMutation = useDeleteStaff();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this staff member?')) return;

    try {
      await deleteMutation.mutateAsync(id!);
      router.push('/app/staff');
    } catch (error) {
      alert('Failed to delete staff member');
    }
  };

  const handleVerifyDocument = async (documentId: string, status: 'verified' | 'rejected', notes?: string) => {
    try {
      const response = await fetch(`/api/staff-documents/${documentId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes }),
      });

      if (!response.ok) {
        throw new Error('Failed to verify document');
      }

      // Refresh the page to show updated status
      router.replace(router.asPath);
    } catch (error) {
      log.error('Document verification failed', { documentId, error });
      alert('Failed to verify document');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !staff) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400">Staff member not found</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-400';
      case 'on_leave': return 'bg-yellow-500/20 text-yellow-400';
      case 'inactive': return 'bg-gray-500/20 text-gray-400';
      case 'suspended': return 'bg-red-500/20 text-red-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.push('/staff')}
          className="inline-flex items-center text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Staff List
        </button>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 bg-blue-500/20 rounded-full flex items-center justify-center">
                <span className="text-xl font-medium text-blue-400">
                  {staff.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                </span>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">{staff.name}</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">{staff.employeeId}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push(`/staff/${id}/edit`)}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
              >
                <Edit className="w-4 h-4 mr-1" />
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 text-sm font-medium text-red-400 bg-[var(--ff-bg-tertiary)] border border-red-500/30 rounded-lg hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--ff-border-light)]">
          <nav className="flex -mb-px px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-3 px-4 text-sm font-medium border-b-2 flex items-center gap-2 ${
                activeTab === 'overview'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              }`}
            >
              <User className="h-4 w-4" />
              Overview
            </button>
            <button
              onClick={() => setActiveTab('documents')}
              className={`py-3 px-4 text-sm font-medium border-b-2 flex items-center gap-2 ${
                activeTab === 'documents'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              }`}
            >
              <FileText className="h-4 w-4" />
              Documents
            </button>
            <button
              onClick={() => setActiveTab('projects')}
              className={`py-3 px-4 text-sm font-medium border-b-2 flex items-center gap-2 ${
                activeTab === 'projects'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
              }`}
            >
              <FolderKanban className="h-4 w-4" />
              Projects
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Documents Tab */}
          {activeTab === 'documents' && (
            <StaffDocumentList staffId={id} isAdmin={true} onVerify={handleVerifyDocument} />
          )}

          {/* Projects Tab */}
          {activeTab === 'projects' && (
            <StaffProjectAssignment staffId={id} staffName={staff.name} />
          )}

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
          {/* Status Badge */}
          <div>
            <span className={`inline-flex px-3 py-1 text-sm font-medium rounded-full ${getStatusColor(staff.status)}`}>
              {staff.status?.replace('_', ' ').toUpperCase() || 'UNKNOWN'}
            </span>
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

          {/* Job Information */}
          <div>
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Job Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <Briefcase className="w-5 h-5 text-[var(--ff-text-muted)]" />
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Position</p>
                  <p className="font-medium text-[var(--ff-text-primary)]">{staff.position}</p>
                </div>
              </div>

              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Department</p>
                <p className="font-medium text-[var(--ff-text-primary)]">
                  {staff.department?.replace('_', ' ').charAt(0).toUpperCase() + (staff.department?.slice(1) || '') || 'Not specified'}
                </p>
              </div>

              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Level</p>
                <p className="font-medium text-[var(--ff-text-primary)]">
                  {staff.level ? staff.level.replace('_', ' ').charAt(0).toUpperCase() + staff.level.slice(1) : 'Not specified'}
                </p>
              </div>

              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Contract Type</p>
                <p className="font-medium text-[var(--ff-text-primary)]">
                  {staff.contractType?.replace('_', ' ').charAt(0).toUpperCase() + (staff.contractType?.slice(1) || '') || 'Not specified'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-[var(--ff-text-muted)]" />
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Start Date</p>
                  <p className="font-medium text-[var(--ff-text-primary)]">
                    {(() => {
                      const startDate = staff.startDate;
                      if (startDate) {
                        try {
                          const date = safeToDate(startDate);
                          return format(date, 'dd MMM yyyy');
                        } catch (error) {
                          log.warn('Error formatting start date:', { data: error }, 'StaffDetail');
                          return 'Invalid Date';
                        }
                      }
                      return 'N/A';
                    })()}
                  </p>
                </div>
              </div>

              {staff.endDate && (
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-[var(--ff-text-muted)]" />
                  <div>
                    <p className="text-sm text-[var(--ff-text-secondary)]">End Date</p>
                    <p className="font-medium text-[var(--ff-text-primary)]">
                      {(() => {
                        const endDate = staff.endDate;
                        if (endDate) {
                          try {
                            const date = safeToDate(endDate);
                            return format(date, 'dd MMM yyyy');
                          } catch (error) {
                            log.warn('Error formatting end date:', { data: error }, 'StaffDetail');
                            return 'Invalid Date';
                          }
                        }
                        return 'N/A';
                      })()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Skills */}
          {staff.skills && Array.isArray(staff.skills) && staff.skills.length > 0 && (
            <div>
              <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Skills</h2>
              <div className="flex flex-wrap gap-2">
                {staff.skills.map((skill: string) => (
                  <span
                    key={skill}
                    className="inline-flex items-center px-3 py-1 text-sm font-medium bg-blue-500/20 text-blue-400 rounded-full"
                  >
                    <Award className="w-3 h-3 mr-1" />
                    {skill?.replace(/_/g, ' ').charAt(0).toUpperCase() + (skill?.slice(1) || '') || skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Project Information */}
          <div>
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Project Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <p className="text-sm text-[var(--ff-text-secondary)]">Current Projects</p>
                <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
                  {staff.currentProjectCount || 0} / {staff.maxProjectCount || 5}
                </p>
                <div className="w-full bg-[var(--ff-border-light)] rounded-full h-2 mt-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{ width: `${((staff.currentProjectCount || 0) / (staff.maxProjectCount || 5)) * 100}%` }}
                  />
                </div>
              </div>

              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <p className="text-sm text-[var(--ff-text-secondary)]">Completed Projects</p>
                <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
                  {staff.totalProjectsCompleted || 0}
                </p>
              </div>

              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <p className="text-sm text-[var(--ff-text-secondary)]">Average Rating</p>
                <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
                  {(staff.averageProjectRating || 0).toFixed(1)} / 5.0
                </p>
              </div>
            </div>
          </div>

          {/* Emergency Contact */}
          {(staff.emergencyContactName || staff.emergencyContactPhone) && (
            <div>
              <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Emergency Contact</h2>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                {staff.emergencyContactName && (
                  <p className="font-medium text-[var(--ff-text-primary)]">{staff.emergencyContactName}</p>
                )}
                {staff.emergencyContactPhone && (
                  <p className="text-sm text-[var(--ff-text-secondary)]">{staff.emergencyContactPhone}</p>
                )}
              </div>
            </div>
          )}

          {/* Address */}
          {staff.address && (
            <div>
              <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Address</h2>
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <p className="text-[var(--ff-text-primary)]">{staff.address}</p>
                <p className="text-[var(--ff-text-secondary)]">{staff.city}, {staff.province} {staff.postalCode}</p>
              </div>
            </div>
          )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}