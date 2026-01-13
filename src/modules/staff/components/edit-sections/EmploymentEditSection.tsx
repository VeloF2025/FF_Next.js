'use client';

import { AlertCircle, Clock } from 'lucide-react';
import {
  StaffFormData,
  StaffLevel,
  StaffStatus,
  Skill,
} from '@/types/staff.types';
import {
  StaffPosition,
  StaffDepartment,
  getPositionsByDepartment,
} from '@/types/staff-hierarchy.types';
import {
  SAContractType,
  SA_CONTRACT_TYPE_LABELS,
  SA_CONTRACT_CONFIG,
  ProbationStatus,
  PROBATION_STATUS_LABELS,
  getDefaultCompliance,
} from '@/types/staff/compliance.types';
import { useStaff } from '@/hooks/useStaff';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface EmploymentEditSectionProps {
  formData: StaffFormData;
  handleInputChange: (field: keyof StaffFormData, value: unknown) => void;
  toggleSkill: (skill: Skill) => void;
}

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-[var(--ff-text-secondary)]";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-secondary)] mb-1";
const selectTriggerClasses = "w-full h-10 px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

export function EmploymentEditSection({ formData, handleInputChange, toggleSkill }: EmploymentEditSectionProps) {
  const { data: staffList } = useStaff();

  const availablePositions = formData.department
    ? getPositionsByDepartment(formData.department)
    : Object.values(StaffPosition);

  const potentialManagers = staffList?.filter(staff =>
    staff.id !== formData.id &&
    ['MD', 'CCSO', 'BDO', 'Head', 'Manager'].some(title =>
      staff.position?.includes(title)
    )
  ) || [];

  const contractType = (formData.saContractType || formData.contractType) as SAContractType;
  const contractConfig = contractType ? SA_CONTRACT_CONFIG[contractType] : null;

  return (
    <div className="space-y-8">
      {/* Job Information */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Job Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Department *</label>
            <Select
              value={formData.department || ''}
              onValueChange={(value) => handleInputChange('department', value)}
            >
              <SelectTrigger className={selectTriggerClasses}>
                <SelectValue placeholder="Select Department" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(StaffDepartment).map(dept => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className={labelClasses}>Position</label>
            <Select
              value={formData.position || ''}
              onValueChange={(value) => handleInputChange('position', value)}
            >
              <SelectTrigger className={selectTriggerClasses}>
                <SelectValue placeholder="Select Position" />
              </SelectTrigger>
              <SelectContent>
                {availablePositions.map(position => (
                  <SelectItem key={position} value={position}>
                    {position}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className={labelClasses}>Level</label>
            <Select
              value={formData.level || ''}
              onValueChange={(value) => handleInputChange('level', value as StaffLevel)}
            >
              <SelectTrigger className={selectTriggerClasses}>
                <SelectValue placeholder="Select Level" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(StaffLevel).map(level => (
                  <SelectItem key={level} value={level}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className={labelClasses}>Reports To</label>
            <Select
              value={formData.reportsTo || '__none__'}
              onValueChange={(value) => handleInputChange('reportsTo', value === '__none__' ? '' : value)}
            >
              <SelectTrigger className={selectTriggerClasses}>
                <SelectValue placeholder="No Direct Manager" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No Direct Manager</SelectItem>
                {potentialManagers.map(manager => (
                  <SelectItem key={manager.id} value={manager.id}>
                    {manager.name} - {manager.position}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className={labelClasses}>Status *</label>
            <Select
              value={formData.status || ''}
              onValueChange={(value) => handleInputChange('status', value as StaffStatus)}
            >
              <SelectTrigger className={selectTriggerClasses}>
                <SelectValue placeholder="Select Status" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(StaffStatus).map(status => (
                  <SelectItem key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className={labelClasses}>Experience Years</label>
            <input
              type="number"
              min="0"
              max="50"
              value={formData.experienceYears || 0}
              onChange={(e) => handleInputChange('experienceYears', parseInt(e.target.value) || 0)}
              className={inputClasses}
            />
          </div>
        </div>
      </div>

      {/* Contract Details */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Contract Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Contract Type *</label>
            <Select
              value={formData.saContractType || formData.contractType || ''}
              onValueChange={(value) => {
                const newType = value as SAContractType;
                handleInputChange('saContractType', newType);
                const defaults = getDefaultCompliance(newType);
                if (defaults.uifStatus) handleInputChange('uifStatus', defaults.uifStatus);
                if (defaults.coidaStatus) handleInputChange('coidaStatus', defaults.coidaStatus);
                if (defaults.taxStatus) handleInputChange('taxStatus', defaults.taxStatus);
                if (defaults.probationStatus) handleInputChange('probationStatus', defaults.probationStatus);
                if (defaults.noticePeriod) handleInputChange('noticePeriod', defaults.noticePeriod);
              }}
            >
              <SelectTrigger className={selectTriggerClasses}>
                <SelectValue placeholder="Select Contract Type" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(SAContractType).map(type => (
                  <SelectItem key={type} value={type}>
                    {SA_CONTRACT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contractConfig && (
              <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
                {contractConfig.description}
              </p>
            )}
          </div>

          <div>
            <label className={labelClasses}>Notice Period (Days)</label>
            <input
              type="number"
              min="0"
              max="90"
              value={formData.noticePeriodDays || 30}
              onChange={(e) => handleInputChange('noticePeriodDays', parseInt(e.target.value) || 30)}
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Start Date *</label>
            <input
              type="date"
              required
              value={formData.startDate ? formData.startDate.toISOString().split('T')[0] : ''}
              onChange={(e) => handleInputChange('startDate', new Date(e.target.value))}
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>End Date</label>
            <input
              type="date"
              value={formData.endDate ? formData.endDate.toISOString().split('T')[0] : ''}
              onChange={(e) => handleInputChange('endDate', e.target.value ? new Date(e.target.value) : null)}
              className={inputClasses}
            />
          </div>
        </div>
      </div>

      {/* Probation Status */}
      {contractConfig?.hasProbation && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Probation Status</h2>
          <div className={`rounded-lg p-4 ${
            formData.probationStatus === ProbationStatus.IN_PROBATION
              ? 'bg-yellow-500/10 border border-yellow-500/30'
              : 'bg-green-500/10 border border-green-500/30'
          }`}>
            <div className="flex items-center gap-2 mb-4">
              <Clock className={`w-5 h-5 ${
                formData.probationStatus === ProbationStatus.IN_PROBATION ? 'text-yellow-400' : 'text-green-400'
              }`} />
              <span className={`font-medium ${
                formData.probationStatus === ProbationStatus.IN_PROBATION ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {formData.probationStatus === ProbationStatus.IN_PROBATION ? 'Currently in Probation' : 'Probation Status'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClasses}>Probation Status</label>
                <Select
                  value={formData.probationStatus || ProbationStatus.IN_PROBATION}
                  onValueChange={(value) => handleInputChange('probationStatus', value as ProbationStatus)}
                >
                  <SelectTrigger className={selectTriggerClasses}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(ProbationStatus).map(status => (
                      <SelectItem key={status} value={status}>
                        {PROBATION_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className={labelClasses}>
                  Probation End Date
                  <span className="text-xs text-[var(--ff-text-muted)] ml-1">
                    (max {contractConfig.maxProbationMonths} months)
                  </span>
                </label>
                <input
                  type="date"
                  value={formData.probationEndDate instanceof Date ? formData.probationEndDate.toISOString().split('T')[0] : ''}
                  onChange={(e) => handleInputChange('probationEndDate', e.target.value ? new Date(e.target.value) : undefined)}
                  className={inputClasses}
                />
              </div>

              <div className="md:col-span-2">
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="checkbox"
                    id="probationExtended"
                    checked={formData.probationExtended || false}
                    onChange={(e) => handleInputChange('probationExtended', e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]"
                  />
                  <label htmlFor="probationExtended" className="text-sm font-medium text-[var(--ff-text-primary)]">
                    Probation Extended
                  </label>
                </div>

                {formData.probationExtended && (
                  <div>
                    <label className={labelClasses}>Extension Reason</label>
                    <input
                      type="text"
                      value={formData.probationExtensionReason || ''}
                      onChange={(e) => handleInputChange('probationExtensionReason', e.target.value)}
                      className={inputClasses}
                      placeholder="Reason for extension..."
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compensation */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Compensation</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Monthly Salary (ZAR)</label>
            <input
              type="number"
              min="0"
              value={formData.salaryAmount || ''}
              onChange={(e) => handleInputChange('salaryAmount', parseFloat(e.target.value) || undefined)}
              className={inputClasses}
              placeholder="Monthly salary"
            />
          </div>

          <div>
            <label className={labelClasses}>Hourly Rate (ZAR)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.hourlyRate || ''}
              onChange={(e) => handleInputChange('hourlyRate', parseFloat(e.target.value) || undefined)}
              className={inputClasses}
              placeholder="Hourly rate"
            />
          </div>

          <div>
            <label className={labelClasses}>Salary Grade</label>
            <input
              type="text"
              value={formData.salaryGrade || ''}
              onChange={(e) => handleInputChange('salaryGrade', e.target.value)}
              className={inputClasses}
              placeholder="e.g., Grade 5, Level C"
            />
          </div>

          <div>
            <label className={labelClasses}>Benefits Package</label>
            <input
              type="text"
              value={formData.benefitsPackage || ''}
              onChange={(e) => handleInputChange('benefitsPackage', e.target.value)}
              className={inputClasses}
              placeholder="e.g., Full Medical, Retirement"
            />
          </div>
        </div>
      </div>

      {/* Project Capacity */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Project Capacity</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Max Project Count</label>
            <input
              type="number"
              min="0"
              max="20"
              value={formData.maxProjectCount || 5}
              onChange={(e) => handleInputChange('maxProjectCount', parseInt(e.target.value) || 5)}
              className={inputClasses}
            />
            <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
              Maximum number of projects this person can be assigned to
            </p>
          </div>

          <div>
            <label className={labelClasses}>Weekly Hours</label>
            <input
              type="number"
              min="1"
              max="45"
              value={formData.weeklyHours || ''}
              onChange={(e) => handleInputChange('weeklyHours', parseInt(e.target.value) || undefined)}
              className={inputClasses}
              placeholder="40-45"
            />
            {contractType === SAContractType.PART_TIME && formData.weeklyHours && formData.weeklyHours >= 24 && (
              <p className="mt-1 text-xs text-amber-400 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Part-time should be &lt;24 hours/week per BCEA
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Skills */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Skills</h2>
        <div className="flex flex-wrap gap-2">
          {Object.values(Skill).map((skill) => (
            <button
              key={skill}
              type="button"
              onClick={() => toggleSkill(skill)}
              className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                formData.skills?.includes(skill)
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]'
              }`}
            >
              {skill.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Availability */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Availability</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Working Hours</label>
            <input
              type="text"
              value={formData.workingHours || ''}
              onChange={(e) => handleInputChange('workingHours', e.target.value)}
              className={inputClasses}
              placeholder="e.g., 08:00 - 17:00"
            />
          </div>

          <div className="flex items-center gap-6 pt-6">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.availableWeekends || false}
                onChange={(e) => handleInputChange('availableWeekends', e.target.checked)}
                className="w-4 h-4 rounded border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]"
              />
              <span className="text-sm text-[var(--ff-text-primary)]">Available Weekends</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.availableNights || false}
                onChange={(e) => handleInputChange('availableNights', e.target.checked)}
                className="w-4 h-4 rounded border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]"
              />
              <span className="text-sm text-[var(--ff-text-primary)]">Available Nights</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
