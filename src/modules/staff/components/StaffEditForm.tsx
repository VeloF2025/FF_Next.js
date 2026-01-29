'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Save, User, Briefcase, Shield } from 'lucide-react';
import { useStaffMember, useUpdateStaff } from '@/hooks/useStaff';
import {
  StaffFormData,
  StaffStatus,
  ContractType,
  Skill,
  isFormerEmployee,
} from '@/types/staff.types';
import { mapLegacyContractType } from '@/types/staff/compliance.types';
import { safeToDate } from '@/utils/dateHelpers';
import { ExitEmployeeModal, ExitFormData } from './ExitEmployeeModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

// Edit form tab sections
import { OverviewEditSection } from './edit-sections/OverviewEditSection';
import { EmploymentEditSection } from './edit-sections/EmploymentEditSection';
import { ComplianceEditSection } from './edit-sections/ComplianceEditSection';

type EditTabType = 'overview' | 'employment' | 'compliance';

const EDIT_TABS: { id: EditTabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'employment', label: 'Employment', icon: Briefcase },
  { id: 'compliance', label: 'Compliance', icon: Shield },
];

export function StaffEditForm() {
  const router = useRouter();
  const { id } = router.query as { id: string };

  const { data: staff, isLoading } = useStaffMember(id || '', { enabled: !!id });
  const updateMutation = useUpdateStaff();

  const [activeTab, setActiveTab] = useState<EditTabType>('overview');
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
    if (staff) {
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
      if (staff.whatsappId) formUpdate.whatsappId = staff.whatsappId;
      if (staff.level) formUpdate.level = staff.level;
      if (staff.reportsTo) formUpdate.reportsTo = staff.reportsTo;
      if (staff.specializations) formUpdate.specializations = staff.specializations;
      if (staff.emergencyContactName) formUpdate.emergencyContactName = staff.emergencyContactName;
      if (staff.emergencyContactPhone) formUpdate.emergencyContactPhone = staff.emergencyContactPhone;
      if (staff.emergencyContactRelationship) formUpdate.emergencyContactRelationship = staff.emergencyContactRelationship;
      if (staff.endDate) formUpdate.endDate = safeToDate(staff.endDate);
      if (staff.salaryGrade) formUpdate.salaryGrade = staff.salaryGrade;
      if (staff.hourlyRate !== undefined) formUpdate.hourlyRate = staff.hourlyRate;
      if (staff.notes) formUpdate.notes = staff.notes;
      if (staff.bio) formUpdate.bio = staff.bio;

      // New HR fields
      if (staff.saIdNumber) formUpdate.saIdNumber = staff.saIdNumber;
      if (staff.passportNumber) formUpdate.passportNumber = staff.passportNumber;
      if (staff.passportCountry) formUpdate.passportCountry = staff.passportCountry;
      if (staff.passportExpiry) formUpdate.passportExpiry = safeToDate(staff.passportExpiry);
      if (staff.nextOfKinName) formUpdate.nextOfKinName = staff.nextOfKinName;
      if (staff.nextOfKinPhone) formUpdate.nextOfKinPhone = staff.nextOfKinPhone;
      if (staff.nextOfKinRelationship) formUpdate.nextOfKinRelationship = staff.nextOfKinRelationship;
      if (staff.nextOfKinAddress) formUpdate.nextOfKinAddress = staff.nextOfKinAddress;
      if (staff.bankName) formUpdate.bankName = staff.bankName;
      if (staff.bankAccountNumber) formUpdate.bankAccountNumber = staff.bankAccountNumber;
      if (staff.bankBranchCode) formUpdate.bankBranchCode = staff.bankBranchCode;
      if (staff.bankAccountType) formUpdate.bankAccountType = staff.bankAccountType;
      if (staff.taxNumber) formUpdate.taxNumber = staff.taxNumber;
      if (staff.noticePeriodDays) formUpdate.noticePeriodDays = staff.noticePeriodDays;
      if (staff.salaryAmount) formUpdate.salaryAmount = staff.salaryAmount;
      if (staff.benefitsPackage) formUpdate.benefitsPackage = staff.benefitsPackage;
      if (staff.probationEndDate) formUpdate.probationEndDate = safeToDate(staff.probationEndDate);
      if (staff.probationExtended !== undefined) formUpdate.probationExtended = staff.probationExtended;
      if (staff.probationExtensionReason) formUpdate.probationExtensionReason = staff.probationExtensionReason;

      // SA Compliance fields - map legacy contract types to SAContractType enum
      // Always set saContractType from contractType to ensure Select shows correct value
      if (staff.saContractType) {
        formUpdate.saContractType = staff.saContractType;
      } else if (staff.contractType) {
        // Map legacy contract types (full-time, fixed-term, etc.) to SAContractType enum values
        formUpdate.saContractType = mapLegacyContractType(staff.contractType as string);
      }
      if (staff.uifStatus) formUpdate.uifStatus = staff.uifStatus;
      if (staff.uifNumber) formUpdate.uifNumber = staff.uifNumber;
      if (staff.coidaStatus) formUpdate.coidaStatus = staff.coidaStatus;
      if (staff.taxStatus) formUpdate.taxStatus = staff.taxStatus;
      if (staff.probationStatus) formUpdate.probationStatus = staff.probationStatus;
      if (staff.noticePeriod) formUpdate.noticePeriod = staff.noticePeriod;
      if (staff.weeklyHours) formUpdate.weeklyHours = staff.weeklyHours;
      if (staff.idNumber) formUpdate.idNumber = staff.idNumber;
      if (staff.workPermitNumber) formUpdate.workPermitNumber = staff.workPermitNumber;
      if (staff.workPermitExpiry) formUpdate.workPermitExpiry = safeToDate(staff.workPermitExpiry);

      // Sync SA ID numbers: ensure both fields have the same value on load
      const saId = formUpdate.saIdNumber || staff.saIdNumber;
      const id = formUpdate.idNumber || staff.idNumber;
      const syncedId = saId || id;
      if (syncedId) {
        formUpdate.saIdNumber = syncedId;
        formUpdate.idNumber = syncedId;
      }

      setFormData(prevData => ({ ...prevData, ...formUpdate }));
    }
  }, [staff]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await updateMutation.mutateAsync({ id: id!, data: formData });
      router.push(`/staff/${id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save staff member';
      setError(errorMessage);
      log.error('Failed to save staff member:', { data: error }, 'StaffEditForm');
    }
  };

  const handleInputChange = (field: keyof StaffFormData, value: unknown) => {
    // Intercept status changes to exit statuses
    if (field === 'status') {
      const newStatus = value as StaffStatus;
      const currentStatus = formData.status;

      if (isFormerEmployee(newStatus) && !isFormerEmployee(currentStatus)) {
        setPendingExitStatus(newStatus);
        setShowExitModal(true);
        return;
      }
    }

    // Sync SA ID Number between Overview (saIdNumber) and Compliance (idNumber)
    if (field === 'saIdNumber') {
      setFormData(prev => ({ ...prev, saIdNumber: value as string, idNumber: value as string }));
      return;
    }
    if (field === 'idNumber') {
      setFormData(prev => ({ ...prev, idNumber: value as string, saIdNumber: value as string }));
      return;
    }

    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleExitConfirm = async (exitData: ExitFormData) => {
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" label="Loading staff member..." />
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400">Staff member not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.push(`/staff/${id}`)}
          className="inline-flex items-center text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Staff Details
        </button>
      </div>

      <form onSubmit={handleSubmit}>
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
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">Edit {staff.name}</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    {staff.position || 'No position'} {staff.employeeId && `• ${staff.employeeId}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push(`/staff/${id}`)}
                  className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateMutation.isPending ? (
                    <>
                      <LoadingSpinner size="sm" className="mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mx-6 mt-4 p-4 text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="font-medium">Error: {error}</p>
            </div>
          )}

          {/* Tabs */}
          <div className="border-b border-[var(--ff-border-light)]">
            <nav className="flex -mb-px px-6" aria-label="Tabs">
              {EDIT_TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`py-3 px-4 text-sm font-medium border-b-2 flex items-center gap-2 ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'overview' && (
              <OverviewEditSection
                formData={formData}
                handleInputChange={handleInputChange}
              />
            )}

            {activeTab === 'employment' && (
              <EmploymentEditSection
                formData={formData}
                handleInputChange={handleInputChange}
                toggleSkill={toggleSkill}
              />
            )}

            {activeTab === 'compliance' && (
              <ComplianceEditSection
                formData={formData}
                handleInputChange={handleInputChange}
              />
            )}
          </div>
        </div>
      </form>

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
