/**
 * Staff API Service
 * Uses API routes instead of direct database access for security
 */

import { StaffMember, StaffDropdownOption, StaffSummary } from '@/types/staff.types';

const API_BASE = '/api';

interface DbStaff {
  id?: string;
  employee_id?: string;
  name: string;
  email?: string;
  phone?: string;
  alternate_phone?: string;
  whatsapp_id?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  department?: string;
  position?: string;
  level?: string;
  type?: string;
  status?: string;
  salary?: number;
  join_date?: string;
  end_date?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  skills?: string[];
  certifications?: string[];
  notes?: string;
  reports_to?: string;
  project_count?: number;
  max_project_count?: number;
  manager_name?: string;
  hourly_rate?: number;
  contract_type?: string;
  working_hours?: string;
  available_weekends?: boolean;
  available_nights?: boolean;
  time_zone?: string;
  experience_years?: number;
  created_at?: string;
  updated_at?: string;
  // Identity document fields (camelCase from API aliases)
  saIdNumber?: string;
  passportNumber?: string;
  passportCountry?: string;
  passportExpiry?: string;
  nationality?: string;
  idNumber?: string;
  workPermitNumber?: string;
  workPermitExpiry?: string;
  // Photo verification fields (camelCase from API aliases)
  profilePhotoUrl?: string;
  idPhotoUrl?: string;
  photoMatchScore?: number;
  photoVerifiedAt?: string;
  // Additional HR fields
  cvUrl?: string;
  cvUploadedAt?: string;
  bio?: string;
  workLocation?: string;
  salaryGrade?: string;
  weeklyHours?: number;
  noticePeriodDays?: number;
  specializations?: string[];
  // Next of kin fields
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelationship?: string;
  nextOfKinAddress?: string;
  // Emergency contact fields (camelCase from API aliases)
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  // Bank details fields (camelCase from API aliases)
  bankName?: string;
  bankAccountNumber?: string;
  bankBranchCode?: string;
  bankAccountType?: string;
  bankAccountHolder?: string;
  bankDetailsVerifiedAt?: string;
  // SA Compliance fields (camelCase from API aliases)
  uifStatus?: string;
  uifNumber?: string;
  coidaStatus?: string;
  taxStatus?: string;
  taxNumber?: string;
  probationStatus?: string;
  probationEndDate?: string;
  probationExtended?: boolean;
  probationExtensionReason?: string;
  noticePeriod?: string;
  // Exit fields
  exitType?: string;
  exitReason?: string;
  isRehireable?: boolean;
}

/**
 * Simple timestamp-like object for compatibility with existing code
 */
interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
}

/**
 * Create a timestamp-like object from a date
 */
function createTimestamp(date: Date): TimestampLike {
  const seconds = Math.floor(date.getTime() / 1000);
  const nanoseconds = (date.getTime() % 1000) * 1000000;
  return {
    seconds,
    nanoseconds,
    toDate: () => date,
  };
}

/**
 * Create a timestamp-like object for the current time
 */
function timestampNow(): TimestampLike {
  return createTimestamp(new Date());
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.data || data;
}

/**
 * Convert ISO date string to TimestampLike
 */
function toTimestamp(dateStr?: string): TimestampLike {
  if (!dateStr) return timestampNow();
  return createTimestamp(new Date(dateStr));
}

/**
 * Transform database row to StaffMember type
 */
function transformDbToStaffMember(dbStaff: DbStaff): StaffMember {
  return {
    id: dbStaff.id,
    employeeId: dbStaff.employee_id || '',
    name: dbStaff.name,
    email: dbStaff.email || '',
    phone: dbStaff.phone || '',
    alternativePhone: dbStaff.alternate_phone,
    whatsappId: dbStaff.whatsapp_id,
    address: dbStaff.address || '',
    city: dbStaff.city || '',
    province: dbStaff.state || '',
    postalCode: dbStaff.postal_code || '',
    department: (dbStaff.department || 'Operations') as StaffMember['department'],
    position: dbStaff.position || '',
    level: dbStaff.level as StaffMember['level'],
    status: (dbStaff.status || 'active') as StaffMember['status'],
    skills: (dbStaff.skills || []) as StaffMember['skills'],
    certifications: (dbStaff.certifications || []) as unknown as StaffMember['certifications'],
    notes: dbStaff.notes,
    reportsTo: dbStaff.reports_to,
    currentProjectCount: dbStaff.project_count || 0,
    maxProjectCount: dbStaff.max_project_count || 5,
    managerName: dbStaff.manager_name,
    startDate: toTimestamp(dbStaff.join_date),
    endDate: dbStaff.end_date ? toTimestamp(dbStaff.end_date) : undefined,
    createdAt: toTimestamp(dbStaff.created_at),
    updatedAt: toTimestamp(dbStaff.updated_at),
    // Required fields with defaults
    experienceYears: dbStaff.experience_years || 0,
    specializations: (dbStaff.specializations || []) as string[],
    contractType: (dbStaff.contract_type || 'permanent') as StaffMember['contractType'],
    workingHours: dbStaff.working_hours || '08:00-17:00',
    availableWeekends: dbStaff.available_weekends || false,
    availableNights: dbStaff.available_nights || false,
    timeZone: dbStaff.time_zone || 'Africa/Johannesburg',
    activeProjectIds: [],
    totalProjectsCompleted: 0,
    averageProjectRating: 0,
    onTimeCompletionRate: 0,
    assignedEquipment: [],
    toolsAssigned: [],
    trainingRecords: [],
    createdBy: '',
    lastModifiedBy: '',
    emergencyContactName: dbStaff.emergencyContactName,
    emergencyContactPhone: dbStaff.emergencyContactPhone,
    hourlyRate: dbStaff.hourly_rate,
    salaryAmount: dbStaff.salary,
    salaryGrade: dbStaff.salaryGrade,
    weeklyHours: dbStaff.weeklyHours,
    noticePeriodDays: dbStaff.noticePeriodDays,
    // Identity document fields
    saIdNumber: dbStaff.saIdNumber,
    passportNumber: dbStaff.passportNumber,
    passportCountry: dbStaff.passportCountry,
    passportExpiry: dbStaff.passportExpiry,
    nationality: dbStaff.nationality,
    idNumber: dbStaff.idNumber,
    workPermitNumber: dbStaff.workPermitNumber,
    workPermitExpiry: dbStaff.workPermitExpiry,
    // Photo verification fields
    profilePhotoUrl: dbStaff.profilePhotoUrl,
    idPhotoUrl: dbStaff.idPhotoUrl,
    photoMatchScore: dbStaff.photoMatchScore,
    photoVerifiedAt: dbStaff.photoVerifiedAt ? toTimestamp(dbStaff.photoVerifiedAt) : undefined,
    // Additional HR fields
    cvUrl: dbStaff.cvUrl,
    cvUploadedAt: dbStaff.cvUploadedAt ? toTimestamp(dbStaff.cvUploadedAt) : undefined,
    bio: dbStaff.bio,
    workLocation: dbStaff.workLocation,
    // Next of kin fields
    nextOfKinName: dbStaff.nextOfKinName,
    nextOfKinPhone: dbStaff.nextOfKinPhone,
    nextOfKinRelationship: dbStaff.nextOfKinRelationship,
    nextOfKinAddress: dbStaff.nextOfKinAddress,
    emergencyContactRelationship: dbStaff.emergencyContactRelationship,
    // Bank details fields
    bankName: dbStaff.bankName,
    bankAccountNumber: dbStaff.bankAccountNumber,
    bankBranchCode: dbStaff.bankBranchCode,
    bankAccountType: dbStaff.bankAccountType as StaffMember['bankAccountType'],
    bankAccountHolder: dbStaff.bankAccountHolder,
    bankDetailsVerifiedAt: dbStaff.bankDetailsVerifiedAt ? toTimestamp(dbStaff.bankDetailsVerifiedAt) : undefined,
    // SA Compliance fields
    uifStatus: dbStaff.uifStatus as StaffMember['uifStatus'],
    uifNumber: dbStaff.uifNumber,
    coidaStatus: dbStaff.coidaStatus as StaffMember['coidaStatus'],
    taxStatus: dbStaff.taxStatus as StaffMember['taxStatus'],
    taxNumber: dbStaff.taxNumber,
    probationStatus: dbStaff.probationStatus as StaffMember['probationStatus'],
    probationEndDate: dbStaff.probationEndDate ? toTimestamp(dbStaff.probationEndDate) : undefined,
    probationExtended: dbStaff.probationExtended,
    probationExtensionReason: dbStaff.probationExtensionReason,
    noticePeriod: dbStaff.noticePeriod as StaffMember['noticePeriod'],
    // Exit fields
    exitType: dbStaff.exitType as StaffMember['exitType'],
    exitReason: dbStaff.exitReason,
    isRehireable: dbStaff.isRehireable,
  };
}

/**
 * Convert date value to ISO string for database
 */
function toDateString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  // Handle TimestampLike object
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as TimestampLike).toDate().toISOString();
  }
  return undefined;
}

/**
 * Convert date value to ISO string or null for database (for clearable fields)
 * Returns null instead of undefined so the field is included in the request
 */
function toDateStringOrNull(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  // Handle TimestampLike object
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as TimestampLike).toDate().toISOString();
  }
  return null;
}

/**
 * Transform StaffMember to database format
 */
function transformStaffMemberToDb(staff: Partial<StaffMember>): Partial<DbStaff> {
  const result: Partial<DbStaff> = {
    id: staff.id,
    employee_id: staff.employeeId,
    name: staff.name,
    email: staff.email,
    phone: staff.phone,
    alternate_phone: staff.alternativePhone,
    whatsapp_id: staff.whatsappId,
    address: staff.address,
    city: staff.city,
    state: staff.province,
    postal_code: staff.postalCode,
    department: staff.department as string,
    position: staff.position as string,
    level: staff.level as string,
    status: staff.status as string,
    salary: staff.salaryAmount,
    join_date: toDateString(staff.startDate),
    end_date: toDateString(staff.endDate),
    emergency_contact_name: staff.emergencyContactName,
    emergency_contact_phone: staff.emergencyContactPhone,
    skills: staff.skills as unknown as string[],
    certifications: staff.certifications as unknown as string[],
    notes: staff.notes,
    reports_to: staff.reportsTo,
    hourly_rate: staff.hourlyRate,
    contract_type: (staff.saContractType || staff.contractType) as string,
    working_hours: staff.workingHours,
    available_weekends: staff.availableWeekends,
    available_nights: staff.availableNights,
    time_zone: staff.timeZone,
    experience_years: staff.experienceYears,
    max_project_count: staff.maxProjectCount,
    // Identity document fields - use empty string or null to allow clearing
    saIdNumber: staff.saIdNumber ?? undefined,
    passportNumber: staff.passportNumber ?? undefined,
    passportCountry: staff.passportCountry ?? undefined,
    passportExpiry: toDateStringOrNull(staff.passportExpiry) ?? undefined,
  };

  // Emergency contact relationship
  if ('emergencyContactRelationship' in staff) {
    result.emergencyContactRelationship = staff.emergencyContactRelationship;
  }

  // Next of kin fields
  if ('nextOfKinName' in staff) result.nextOfKinName = staff.nextOfKinName;
  if ('nextOfKinPhone' in staff) result.nextOfKinPhone = staff.nextOfKinPhone;
  if ('nextOfKinRelationship' in staff) result.nextOfKinRelationship = staff.nextOfKinRelationship;
  if ('nextOfKinAddress' in staff) result.nextOfKinAddress = staff.nextOfKinAddress;

  // Bank details
  if ('bankName' in staff) result.bankName = staff.bankName;
  if ('bankAccountNumber' in staff) result.bankAccountNumber = staff.bankAccountNumber;
  if ('bankBranchCode' in staff) result.bankBranchCode = staff.bankBranchCode;
  if ('bankAccountType' in staff) result.bankAccountType = staff.bankAccountType;

  // SA Compliance fields - map to camelCase for API (matches RETURNING aliases)
  if ('uifStatus' in staff) (result as any).uifStatus = staff.uifStatus;
  if ('uifNumber' in staff) (result as any).uifNumber = staff.uifNumber;
  if ('coidaStatus' in staff) (result as any).coidaStatus = staff.coidaStatus;
  if ('taxStatus' in staff) (result as any).taxStatus = staff.taxStatus;
  if ('taxNumber' in staff) (result as any).taxNumber = staff.taxNumber;
  if ('probationStatus' in staff) (result as any).probationStatus = staff.probationStatus;
  if ('probationEndDate' in staff) (result as any).probationEndDate = toDateStringOrNull(staff.probationEndDate);
  if ('probationExtended' in staff) (result as any).probationExtended = staff.probationExtended;
  if ('probationExtensionReason' in staff) (result as any).probationExtensionReason = staff.probationExtensionReason;
  if ('noticePeriod' in staff) (result as any).noticePeriod = staff.noticePeriod;
  if ('noticePeriodDays' in staff) (result as any).noticePeriodDays = staff.noticePeriodDays;
  if ('weeklyHours' in staff) (result as any).weeklyHours = staff.weeklyHours;
  if ('idNumber' in staff) (result as any).idNumber = staff.idNumber;
  if ('workPermitNumber' in staff) (result as any).workPermitNumber = staff.workPermitNumber;
  if ('workPermitExpiry' in staff) (result as any).workPermitExpiry = toDateStringOrNull(staff.workPermitExpiry);
  if ('salaryGrade' in staff) (result as any).salaryGrade = staff.salaryGrade;
  if ('benefitsPackage' in staff) (result as any).benefitsPackage = staff.benefitsPackage;
  if ('bio' in staff) result.bio = staff.bio;
  if ('specializations' in staff) (result as any).specializations = staff.specializations;
  if ('saContractType' in staff) (result as any).saContractType = staff.saContractType;

  // Exit fields
  if ('exitType' in staff) (result as any).exitType = staff.exitType;
  if ('exitReason' in staff) (result as any).exitReason = staff.exitReason;
  if ('isRehireable' in staff) (result as any).isRehireable = staff.isRehireable;

  return result;
}

export const staffApiService = {
  async getAll(filter?: Record<string, unknown>): Promise<StaffMember[]> {
    const params = new URLSearchParams();
    if (filter) {
      if (filter.search || filter.searchTerm) params.append('search', String(filter.search || filter.searchTerm));
      if (filter.department) params.append('department', String(filter.department));
      if (filter.status) params.append('status', String(filter.status));
      if (filter.position) params.append('position', String(filter.position));
    }
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_BASE}/staff${queryString}`);
    const dbStaff = await handleResponse<DbStaff[]>(response);
    return dbStaff.map(transformDbToStaffMember);
  },

  async getById(id: string): Promise<StaffMember | null> {
    const response = await fetch(`${API_BASE}/staff?id=${id}`);
    const dbStaff = await handleResponse<DbStaff | null>(response);
    return dbStaff ? transformDbToStaffMember(dbStaff) : null;
  },

  async create(staffData: Partial<StaffMember>): Promise<StaffMember> {
    const dbData = transformStaffMemberToDb(staffData);
    const response = await fetch(`${API_BASE}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dbData)
    });
    const dbStaff = await handleResponse<DbStaff>(response);
    return transformDbToStaffMember(dbStaff);
  },

  async update(id: string, updates: Partial<StaffMember>): Promise<StaffMember> {
    const dbUpdates = transformStaffMemberToDb(updates);
    const response = await fetch(`${API_BASE}/staff?id=${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dbUpdates)
    });
    const dbStaff = await handleResponse<DbStaff>(response);
    return transformDbToStaffMember(dbStaff);
  },

  async delete(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/staff?id=${id}`, {
      method: 'DELETE'
    });
    await handleResponse<{ success: boolean; message: string }>(response);
  },

  // Compatibility methods to match existing service interface
  async getActiveStaff(): Promise<StaffDropdownOption[]> {
    const staff = await this.getAll();
    return staff
      .filter(s => s.status === 'active')
      .map(s => ({
        id: s.id || '',
        name: s.name,
        email: s.email,
        position: s.position as string,
        department: s.department,
        status: s.status,
        currentProjectCount: s.currentProjectCount,
        maxProjectCount: s.maxProjectCount,
      }));
  },

  async getStaffByDepartment(department: string): Promise<StaffMember[]> {
    const staff = await this.getAll();
    return staff.filter(s => s.department === department);
  },

  async getStaffSummary(): Promise<StaffSummary> {
    const staff = await this.getAll();
    const departments = [...new Set(staff.map(s => s.department).filter(Boolean))] as string[];
    const activeSalaries = staff
      .filter(s => s.status === 'active' && s.salaryAmount)
      .map(s => s.salaryAmount || 0);

    // Group by department
    const staffByDepartment: Record<string, number> = {};
    staff.forEach(s => {
      const dept = (s.department as string) || 'Unknown';
      staffByDepartment[dept] = (staffByDepartment[dept] || 0) + 1;
    });

    // Group by level
    const staffByLevel: Record<string, number> = {};
    staff.forEach(s => {
      const level = (s.level as string) || 'Unknown';
      staffByLevel[level] = (staffByLevel[level] || 0) + 1;
    });

    // Group by contract type
    const staffByContractType: Record<string, number> = {};
    staff.forEach(s => {
      const type = (s.contractType as string) || 'permanent';
      staffByContractType[type] = (staffByContractType[type] || 0) + 1;
    });

    // Aggregate skills
    const skillCounts: Record<string, number> = {};
    staff.forEach(s => {
      (s.skills || []).forEach((skill: unknown) => {
        const skillName = typeof skill === 'string' ? skill : (skill as { name?: string })?.name || 'Unknown';
        skillCounts[skillName] = (skillCounts[skillName] || 0) + 1;
      });
    });
    const topSkills = Object.entries(skillCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([skill, count]) => ({ skill, count }));

    // Top performers (by rating)
    const topPerformers = staff
      .filter(s => s.averageProjectRating > 0)
      .sort((a, b) => b.averageProjectRating - a.averageProjectRating)
      .slice(0, 5)
      .map(s => ({
        id: s.id || '',
        name: s.name,
        rating: s.averageProjectRating,
        projectsCompleted: s.totalProjectsCompleted,
      }));

    const activeStaff = staff.filter(s => s.status === 'active');
    const availableStaff = activeStaff.filter(s => s.currentProjectCount < s.maxProjectCount);

    return {
      totalStaff: staff.length,
      activeStaff: activeStaff.length,
      inactiveStaff: staff.filter(s => s.status === 'inactive').length,
      onLeaveStaff: staff.filter(s => s.status === 'on_leave').length,
      availableStaff: availableStaff.length,
      monthlyGrowth: 0,
      averageProjectLoad: activeStaff.length > 0
        ? activeStaff.reduce((sum, s) => sum + s.currentProjectCount, 0) / activeStaff.length
        : 0,
      staffByDepartment,
      staffByLevel,
      staffBySkill: skillCounts,
      staffByContractType,
      // Note: averageSalary is computed but not in StaffSummary type - omitted
      averageExperience: staff.length > 0
        ? staff.reduce((sum, s) => sum + (s.experienceYears || 0), 0) / staff.length
        : 0,
      utilizationRate: activeStaff.length > 0
        ? (activeStaff.filter(s => s.currentProjectCount > 0).length / activeStaff.length) * 100
        : 0,
      overallocatedStaff: staff.filter(s => s.currentProjectCount > s.maxProjectCount).length,
      underutilizedStaff: activeStaff.filter(s => s.currentProjectCount === 0).length,
      topPerformers,
      topSkills,
    };
  }
};
