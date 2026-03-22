/**
 * Custom hook for Staff Form logic
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useStaffMember, useCreateStaff, useUpdateStaff } from '@/hooks/useStaff';
import { safeToDate } from '@/utils/dateHelpers';
import { log } from '@/lib/logger';
import { 
  StaffFormData, 
  Department, 
  Position,
  StaffStatus, 
  ContractType,
  Skill 
} from '@/types/staff.types';

const getInitialFormData = (): StaffFormData => ({
  name: '',
  email: '',
  phone: '',
  alternativePhone: '',
  employeeId: '',
  position: Position.FIELD_TECHNICIAN,
  department: Department.FIELD_OPERATIONS,
  status: StaffStatus.ACTIVE,
  skills: [],
  experienceYears: 0,
  address: '',
  city: 'Johannesburg',
  province: 'Gauteng',
  postalCode: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  startDate: new Date(),
  contractType: ContractType.PERMANENT,
  workingHours: '08:00 - 17:00',
  availableWeekends: false,
  availableNights: false,
  timeZone: 'Africa/Johannesburg',
  maxProjectCount: 5,
});

export function useStaffForm(id?: string) {
  const router = useRouter();
  const isEditing = !!id;
  
  const { data: staff, isLoading } = useStaffMember(id || '');
  const createMutation = useCreateStaff();
  const updateMutation = useUpdateStaff();

  const [formData, setFormData] = useState<StaffFormData>(getInitialFormData());

  useEffect(() => {
    if (staff && isEditing) {
      const formDataUpdate: StaffFormData = {
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        alternativePhone: staff.alternativePhone || '',
        employeeId: staff.employeeId,
        position: staff.position,
        department: staff.department,
        status: staff.status,
        skills: staff.skills,
        experienceYears: staff.experienceYears,
        address: staff.address,
        city: staff.city,
        province: staff.province,
        postalCode: staff.postalCode,
        emergencyContactName: staff.emergencyContactName || '',
        emergencyContactPhone: staff.emergencyContactPhone || '',
        startDate: safeToDate(staff.startDate),
        contractType: staff.contractType,
        workingHours: staff.workingHours,
        availableWeekends: staff.availableWeekends,
        availableNights: staff.availableNights,
        timeZone: staff.timeZone,
        maxProjectCount: staff.maxProjectCount,
        managerId: staff.reportsTo || '',
      };

      // Add optional fields only if they exist
      if (staff.endDate) {
        formDataUpdate.endDate = safeToDate(staff.endDate);
      }
      if (staff.hourlyRate !== undefined) {
        formDataUpdate.hourlyRate = staff.hourlyRate;
      }
      if (staff.salaryGrade) {
        formDataUpdate.salaryGrade = staff.salaryGrade;
      }

      setFormData(formDataUpdate);
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
      router.push('/app/staff');
    } catch (error) {
      log.error('Failed to save staff member:', { data: error }, 'useStaffForm');
    }
  };

  const handleInputChange = (field: keyof StaffFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleSkill = (skill: Skill) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter(s => s !== skill)
        : [...prev.skills, skill]
    }));
  };

  return {
    formData,
    isEditing,
    isLoading,
    handleSubmit,
    handleInputChange,
    toggleSkill,
    createMutation,
    updateMutation,
    navigate
  };
}