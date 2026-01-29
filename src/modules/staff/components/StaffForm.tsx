'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Save, User } from 'lucide-react';
import { useStaffMember, useCreateStaff, useUpdateStaff } from '@/hooks/useStaff';
import {
  StaffFormData,
  StaffStatus,
  ContractType,
  Skill,
  isFormerEmployee,
} from '@/types/staff.types';
import { getPositionsByDepartment } from '@/types/staff-hierarchy.types';
import { safeToDate } from '@/utils/dateHelpers';
import {
  PersonalInfoSection,
  EmploymentSection,
  EmergencyContactSection,
  AvailabilitySection,
  SkillsSection
} from './StaffFormSections';
import { ExitEmployeeModal, ExitFormData } from './ExitEmployeeModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

export function StaffForm() {
  const router = useRouter();
  const { id } = router.query as { id: string };
  const isEditing = !!id;

  const { data: staff, isLoading } = useStaffMember(id || '', { enabled: !!id });
  const createMutation = useCreateStaff();
  const updateMutation = useUpdateStaff();

  const [error, setError] = useState<string | null>(null);
  const [showExitModal, setShowExitModal] = useState(false);
  const [pendingExitStatus, setPendingExitStatus] = useState<StaffStatus | null>(null);
  const [formData, setFormData] = useState<StaffFormData>({
    name: '',
    email: '',
    phone: '',
    employeeId: '',
    position: '',
    department: 'field_operations',
    status: StaffStatus.ACTIVE,
    skills: [],
    experienceYears: 0,
    address: '',
    city: 'Johannesburg',
    province: 'Gauteng',
    postalCode: '',
    startDate: new Date(),
    contractType: ContractType.PERMANENT,
    workingHours: '08:00 - 17:00',
    availableWeekends: false,
    availableNights: false,
    timeZone: 'Africa/Johannesburg',
    maxProjectCount: 5
  });

  useEffect(() => {
    if (staff && isEditing) {
      // Handle date conversion - could be Date, string, or object with seconds (Firebase Timestamp format)
      const startDate = typeof staff.startDate === 'object' && staff.startDate !== null && 'seconds' in staff.startDate
        ? new Date((staff.startDate as { seconds: number }).seconds * 1000)
        : new Date(staff.startDate);

      const formUpdate: Partial<StaffFormData> = {
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        employeeId: staff.employeeId,
        position: typeof staff.position === 'string' ? staff.position : String(staff.position),
        department: typeof staff.department === 'string' ? staff.department : String(staff.department),
        status: staff.status,
        skills: staff.skills || [],
        experienceYears: staff.experienceYears || 0,
        address: staff.address,
        city: staff.city,
        province: staff.province,
        postalCode: staff.postalCode,
        startDate: startDate,
        contractType: staff.contractType,
        workingHours: staff.workingHours || '08:00 - 17:00',
        availableWeekends: staff.availableWeekends || false,
        availableNights: staff.availableNights || false,
        timeZone: staff.timeZone || 'Africa/Johannesburg',
        maxProjectCount: staff.maxProjectCount || 5
      };
      
      // Add optional fields only if they exist
      if (staff.id) formUpdate.id = staff.id;
      if (staff.alternativePhone) formUpdate.alternativePhone = staff.alternativePhone;
      if (staff.level) formUpdate.level = staff.level;
      if (staff.reportsTo) formUpdate.reportsTo = staff.reportsTo;
      if (staff.specializations) formUpdate.specializations = staff.specializations;
      if (staff.emergencyContactName) formUpdate.emergencyContactName = staff.emergencyContactName;
      if (staff.emergencyContactPhone) formUpdate.emergencyContactPhone = staff.emergencyContactPhone;
      if (staff.endDate) formUpdate.endDate = safeToDate(staff.endDate);
      if (staff.salaryGrade) formUpdate.salaryGrade = staff.salaryGrade;
      if (staff.hourlyRate !== undefined) formUpdate.hourlyRate = staff.hourlyRate;
      if (staff.notes) formUpdate.notes = staff.notes;
      if (staff.bio) formUpdate.bio = staff.bio;
      
      setFormData(prevData => ({ ...prevData, ...formUpdate }));
    }
  }, [staff, isEditing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isEditing) {
        await updateMutation.mutateAsync({ id: id!, data: formData });
      } else {
        await createMutation.mutateAsync(formData);
      }
      router.push('/staff');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save staff member';
      setError(errorMessage);
      log.error('Failed to save staff member:', { data: error }, 'StaffForm');
    }
  };

  const handleInputChange = (field: keyof StaffFormData, value: any) => {
    // Clear position when department changes if current position doesn't belong to new department
    if (field === 'department') {
      const newDept = value as string;
      const validPositions = getPositionsByDepartment(newDept);
      setFormData(prev => ({
        ...prev,
        department: newDept,
        position: validPositions.includes(prev.position || '') ? prev.position : '',
      }));
      return;
    }

    // Intercept status changes to exit statuses
    if (field === 'status') {
      const newStatus = value as StaffStatus;
      const currentStatus = formData.status;

      // Check if changing to an exit status from a non-exit status
      if (isFormerEmployee(newStatus) && !isFormerEmployee(currentStatus)) {
        // Show exit modal instead of immediately changing status
        setPendingExitStatus(newStatus);
        setShowExitModal(true);
        return;
      }
    }

    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleExitConfirm = async (exitData: ExitFormData) => {
    // Apply exit data to form
    setFormData(prev => ({
      ...prev,
      status: exitData.finalStatus,
      exitType: exitData.exitType,
      exitReason: exitData.exitReason,
      endDate: new Date(exitData.endDate),
      isRehireable: exitData.isRehireable,
    }));
  };

  const handleExitModalClose = () => {
    setShowExitModal(false);
    setPendingExitStatus(null);
  };

  const toggleSkill = (skill: Skill) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter(s => s !== skill)
        : [...prev.skills, skill]
    }));
  };

  if (isLoading && isEditing) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" label="Loading staff member..." />
      </div>
    );
  }

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
        <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-3">
            <User className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
              {isEditing ? 'Edit Staff Member' : 'Add New Staff Member'}
            </h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-4 text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span className="font-medium">Error:</span>
              </div>
              <p className="mt-1 ml-7">{error}</p>
            </div>
          )}
          <PersonalInfoSection 
            formData={formData} 
            handleInputChange={handleInputChange} 
          />
          
          <EmploymentSection 
            formData={formData} 
            handleInputChange={handleInputChange}
          />
          
          {/* Address section removed - handled in PersonalInfoSection */}
          
          <EmergencyContactSection 
            formData={formData} 
            handleInputChange={handleInputChange}
          />
          
          <AvailabilitySection 
            formData={formData} 
            handleInputChange={handleInputChange}
          />
          
          <SkillsSection 
            formData={formData}
            handleInputChange={handleInputChange}
            toggleSkill={toggleSkill}
          />

          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
            <button
              type="button"
              onClick={() => router.push('/staff')}
              className="px-6 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="inline-flex items-center px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {isEditing ? 'Update Staff Member' : 'Create Staff Member'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Exit Employee Modal */}
      <ExitEmployeeModal
        isOpen={showExitModal}
        onClose={handleExitModalClose}
        onConfirm={handleExitConfirm}
        staffName={formData.name || 'Employee'}
        staffId={id || ''}
        currentStatus={formData.status}
        targetStatus={pendingExitStatus || StaffStatus.RESIGNED}
      />
    </div>
  );
}