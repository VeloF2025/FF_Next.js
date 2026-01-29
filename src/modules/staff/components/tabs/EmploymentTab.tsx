'use client';

import { Briefcase, Calendar, Clock, Award, Users } from 'lucide-react';
import { format } from 'date-fns';
import { safeToDate } from '@/utils/dateHelpers';
import type { StaffMember } from '@/types/staff';
import { SA_CONTRACT_TYPE_LABELS } from '@/types/staff/compliance.types';
import { formatLabel } from '@/lib/utils';

interface EmploymentTabProps {
  staff: StaffMember;
}

export function EmploymentTab({ staff }: EmploymentTabProps) {
  const formatDate = (date: unknown): string => {
    if (!date) return 'N/A';
    try {
      return format(safeToDate(date), 'dd MMM yyyy');
    } catch {
      return 'Invalid Date';
    }
  };

  const formatCurrency = (amount?: number): string => {
    if (!amount) return 'Not specified';
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const contractTypeLabel = staff.saContractType
    ? SA_CONTRACT_TYPE_LABELS[staff.saContractType] || staff.saContractType
    : formatLabel(staff.contractType, 'Not specified');

  return (
    <div className="space-y-6">
      {/* Job Information */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Job Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <Briefcase className="w-5 h-5 text-[var(--ff-text-muted)]" />
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Position</p>
              <p className="font-medium text-[var(--ff-text-primary)]">{staff.position || 'Not specified'}</p>
            </div>
          </div>

          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Department</p>
            <p className="font-medium text-[var(--ff-text-primary)]">
              {formatLabel(staff.department, 'Not specified')}
            </p>
          </div>

          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Employee ID</p>
            <p className="font-medium text-[var(--ff-text-primary)] font-mono">
              {staff.employeeId || 'Not assigned'}
            </p>
          </div>

          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Level</p>
            <p className="font-medium text-[var(--ff-text-primary)]">
              {formatLabel(staff.level, 'Not specified')}
            </p>
          </div>

          {staff.managerId && (
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Reports To</p>
                <p className="font-medium text-[var(--ff-text-primary)]">
                  {staff.managerName || 'Manager'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contract Details */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Contract Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Contract Type</p>
            <p className="font-medium text-[var(--ff-text-primary)]">{contractTypeLabel}</p>
            {staff.isEmployee !== undefined && (
              <span className={`inline-flex mt-2 px-2 py-0.5 text-xs rounded-full ${
                staff.isEmployee
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-purple-500/20 text-purple-400'
              }`}>
                {staff.isEmployee ? 'Employee' : 'Independent Contractor'}
              </span>
            )}
          </div>

          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <p className="text-sm text-[var(--ff-text-secondary)]">Notice Period</p>
            <p className="font-medium text-[var(--ff-text-primary)]">
              {staff.noticePeriodDays ? `${staff.noticePeriodDays} days` : '30 days (default)'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-[var(--ff-text-muted)]" />
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Start Date</p>
              <p className="font-medium text-[var(--ff-text-primary)]">{formatDate(staff.startDate)}</p>
            </div>
          </div>

          {staff.endDate && (
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-[var(--ff-text-muted)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">End Date</p>
                <p className="font-medium text-[var(--ff-text-primary)]">{formatDate(staff.endDate)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Probation Status */}
      {(staff.inProbation || staff.probationEndDate) && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Probation Status</h2>
          <div className={`rounded-lg p-4 ${
            staff.inProbation
              ? 'bg-yellow-500/10 border border-yellow-500/30'
              : 'bg-green-500/10 border border-green-500/30'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <Clock className={`w-5 h-5 ${staff.inProbation ? 'text-yellow-400' : 'text-green-400'}`} />
              <span className={`font-medium ${staff.inProbation ? 'text-yellow-400' : 'text-green-400'}`}>
                {staff.inProbation ? 'Currently in Probation' : 'Probation Completed'}
              </span>
            </div>
            {staff.probationEndDate && (
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {staff.inProbation ? 'Ends' : 'Ended'}: {formatDate(staff.probationEndDate)}
              </p>
            )}
            {staff.probationExtended && (
              <div className="mt-2 p-2 bg-yellow-500/10 rounded">
                <p className="text-sm text-yellow-400">Probation Extended</p>
                {staff.probationExtensionReason && (
                  <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
                    {staff.probationExtensionReason}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Compensation */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Compensation</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {staff.salaryAmount && (
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <p className="text-sm text-[var(--ff-text-secondary)]">Monthly Salary</p>
              <p className="text-xl font-semibold text-[var(--ff-text-primary)]">
                {formatCurrency(staff.salaryAmount)}
              </p>
            </div>
          )}

          {staff.hourlyRate && (
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <p className="text-sm text-[var(--ff-text-secondary)]">Hourly Rate</p>
              <p className="text-xl font-semibold text-[var(--ff-text-primary)]">
                {formatCurrency(staff.hourlyRate)} /hr
              </p>
            </div>
          )}

          {staff.salaryGrade && (
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <p className="text-sm text-[var(--ff-text-secondary)]">Salary Grade</p>
              <p className="font-medium text-[var(--ff-text-primary)]">{staff.salaryGrade}</p>
            </div>
          )}

          {staff.benefitsPackage && (
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
              <p className="text-sm text-[var(--ff-text-secondary)]">Benefits Package</p>
              <p className="font-medium text-[var(--ff-text-primary)]">{staff.benefitsPackage}</p>
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
                {formatLabel(skill)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Project Stats */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Project Statistics</h2>
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
    </div>
  );
}
