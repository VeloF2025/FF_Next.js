/**
 * Staff Hierarchy and Organization Types
 * Based on VelocityFibre organizational structure
 */

// Comprehensive list of positions based on import data
export enum StaffPosition {
  // Executive Level
  MD = 'MD',
  CCSO = 'CCSO',
  BDO = 'BDO',
  
  // Head/Director Level
  HEAD_OF_OPERATIONS = 'Head of Operations',
  HEAD_OF_PLANNING = 'Head of Planning',
  HEAD_OF_PROCUREMENT = 'Head of Procurement',
  HEAD_OF_ACQUISITIONS = 'Head of Acquisitions',
  HEAD_OF_OPTICAL = 'Head of Optical',
  
  // Manager Level
  SHEQ_MANAGER = 'SHEQ Manager',
  PROJECT_MANAGER = 'Project Manager',
  OPTICAL_PROJECT_MANAGER = 'Optical Project Manager',
  REGIONAL_PROJECT_MANAGER = 'Regional Project Manager',
  SITE_MANAGER = 'Site Manager',
  DATA_MANAGER = 'Data Manager',
  
  // Senior Level
  SENIOR_TECHNICIAN = 'Senior Technician',
  SENIOR_PLANNER = 'Senior Planner',
  
  // Mid Level
  TECHNICIAN = 'Technician',
  PLANNER = 'Planner',
  CLO = 'CLO',
  WAYLEAVE_OFFICER = 'Wayleave Officer',
  
  // Support Level
  ADMIN = 'Admin',
  DATA_CAPTURER = 'Data Capturer',
  ADMIN_ASSISTANT = 'Administrative Assistant',
  
  // Field Operations (additional standard positions)
  FIELD_TECHNICIAN = 'Field Technician',
  CABLE_JOINTER = 'Cable Jointer',
  FIBRE_SPLICER = 'Fibre Splicer',
  NETWORK_ENGINEER = 'Network Engineer',
  QUALITY_INSPECTOR = 'Quality Inspector',
  SAFETY_OFFICER = 'Safety Officer',
  TEAM_LEAD = 'Team Lead',
  LOGISTICS_COORDINATOR = 'Logistics Coordinator',
  DRIVER = 'Driver',
  GENERAL_WORKER = 'General Worker',
  INTERN = 'Intern',

  // Finance Department Positions
  FINANCIAL_MANAGER = 'Financial Manager',
  ACCOUNTANT = 'Accountant',
  BOOKKEEPER = 'Bookkeeper',
  FINANCIAL_CONTROLLER = 'Financial Controller',
  ACCOUNTS_PAYABLE = 'Accounts Payable',
  ACCOUNTS_RECEIVABLE = 'Accounts Receivable',
  PAYROLL_ADMINISTRATOR = 'Payroll Administrator',

  // HR Department Positions
  HR_MANAGER = 'HR Manager',
  HR_OFFICER = 'HR Officer',
  RECRUITMENT_SPECIALIST = 'Recruitment Specialist',

  OTHER = 'Other'
}

// Comprehensive list of departments
export enum StaffDepartment {
  // Core Operations
  OPERATIONS = 'Operations',
  SERVICE_DELIVERY = 'Service Delivery',
  
  // Business Functions
  BUSINESS_DEVELOPMENT = 'Business Development',
  COMMERCIAL_STRATEGY = 'Commercial & Strategy',
  
  // Support Functions
  PLANNING = 'Planning',
  PROCUREMENT = 'Procurement',
  SHEQ = 'SHEQ', // Safety, Health, Environment, Quality
  
  // Administrative
  ADMIN = 'Admin',
  FINANCE = 'Finance',
  HR = 'Human Resources',
  
  // Technical
  IT_DATA = 'IT & Data',
  NETWORK_OPERATIONS = 'Network Operations',
  ENGINEERING = 'Engineering',
  INSTALLATION = 'Installation',
  MAINTENANCE = 'Maintenance',
  QUALITY_ASSURANCE = 'Quality Assurance',
  TECHNICAL_SUPPORT = 'Technical Support',
  
  // Other
  SALES = 'Sales',
  CUSTOMER_SERVICE = 'Customer Service',
  LOGISTICS = 'Logistics',
  SAFETY = 'Safety'
}

// Reporting structure
export interface ReportingStructure {
  employeeId: string;
  employeeName: string;
  position: string;
  department: string;
  reportsTo?: string; // Employee ID of manager
  reportsToName?: string; // Name of manager
  directReports?: string[]; // Employee IDs of direct reports
  level?: number; // Organizational level (1 = MD, 2 = Heads, etc.)
}

// Position configuration for settings
export interface PositionConfig {
  id: string;
  name: string;
  department?: string;
  level: number; // 1-10 scale for hierarchy
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Department configuration for settings
export interface DepartmentConfig {
  id: string;
  name: string;
  headEmployeeId?: string;
  headEmployeeName?: string;
  parentDepartment?: string;
  isActive: boolean;
  employeeCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

// Helper function to get position level
export function getPositionLevel(position: string): number {
  const levelMap: Record<string, number> = {
    // Level 1 - Executive
    [StaffPosition.MD]: 1,
    
    // Level 2 - C-Suite
    [StaffPosition.CCSO]: 2,
    [StaffPosition.BDO]: 2,
    
    // Level 3 - Heads/Directors
    [StaffPosition.HEAD_OF_OPERATIONS]: 3,
    [StaffPosition.HEAD_OF_PLANNING]: 3,
    [StaffPosition.HEAD_OF_PROCUREMENT]: 3,
    [StaffPosition.HEAD_OF_ACQUISITIONS]: 3,
    [StaffPosition.HEAD_OF_OPTICAL]: 3,
    
    // Level 4 - Managers
    [StaffPosition.SHEQ_MANAGER]: 4,
    [StaffPosition.PROJECT_MANAGER]: 4,
    [StaffPosition.OPTICAL_PROJECT_MANAGER]: 4,
    [StaffPosition.REGIONAL_PROJECT_MANAGER]: 4,
    [StaffPosition.SITE_MANAGER]: 4,
    [StaffPosition.DATA_MANAGER]: 4,
    
    // Level 5 - Senior Staff
    [StaffPosition.SENIOR_TECHNICIAN]: 5,
    [StaffPosition.SENIOR_PLANNER]: 5,
    
    // Level 6 - Mid Level
    [StaffPosition.TECHNICIAN]: 6,
    [StaffPosition.PLANNER]: 6,
    [StaffPosition.CLO]: 6,
    [StaffPosition.WAYLEAVE_OFFICER]: 6,
    
    // Level 7 - Support
    [StaffPosition.ADMIN]: 7,
    [StaffPosition.DATA_CAPTURER]: 7,
    [StaffPosition.ADMIN_ASSISTANT]: 7,
    
    // Default
    [StaffPosition.OTHER]: 8,
  };
  
  return levelMap[position] || 8;
}

// Get all positions for a specific department
export function getPositionsByDepartment(department: string): string[] {
  const departmentPositions: Record<string, string[]> = {
    [StaffDepartment.OPERATIONS]: [
      StaffPosition.HEAD_OF_OPERATIONS,
      StaffPosition.HEAD_OF_OPTICAL,
      StaffPosition.PROJECT_MANAGER,
      StaffPosition.OPTICAL_PROJECT_MANAGER,
      StaffPosition.REGIONAL_PROJECT_MANAGER,
      StaffPosition.SITE_MANAGER,
      StaffPosition.SENIOR_TECHNICIAN,
      StaffPosition.TECHNICIAN,
      StaffPosition.FIELD_TECHNICIAN,
      StaffPosition.FIBRE_SPLICER,
      StaffPosition.CABLE_JOINTER,
    ],
    [StaffDepartment.SERVICE_DELIVERY]: [
      StaffPosition.ADMIN,
      StaffPosition.ADMIN_ASSISTANT,
      StaffPosition.DATA_CAPTURER,
    ],
    [StaffDepartment.BUSINESS_DEVELOPMENT]: [
      StaffPosition.BDO,
      StaffPosition.HEAD_OF_ACQUISITIONS,
      StaffPosition.CLO,
      StaffPosition.WAYLEAVE_OFFICER,
    ],
    [StaffDepartment.PLANNING]: [
      StaffPosition.HEAD_OF_PLANNING,
      StaffPosition.SENIOR_PLANNER,
      StaffPosition.PLANNER,
    ],
    [StaffDepartment.PROCUREMENT]: [
      StaffPosition.HEAD_OF_PROCUREMENT,
    ],
    [StaffDepartment.SHEQ]: [
      StaffPosition.SHEQ_MANAGER,
      StaffPosition.SAFETY_OFFICER,
      StaffPosition.QUALITY_INSPECTOR,
    ],
    [StaffDepartment.IT_DATA]: [
      StaffPosition.DATA_MANAGER,
      StaffPosition.NETWORK_ENGINEER,
    ],
    [StaffDepartment.COMMERCIAL_STRATEGY]: [
      StaffPosition.CCSO,
    ],
    [StaffDepartment.FINANCE]: [
      StaffPosition.FINANCIAL_MANAGER,
      StaffPosition.FINANCIAL_CONTROLLER,
      StaffPosition.ACCOUNTANT,
      StaffPosition.BOOKKEEPER,
      StaffPosition.ACCOUNTS_PAYABLE,
      StaffPosition.ACCOUNTS_RECEIVABLE,
      StaffPosition.PAYROLL_ADMINISTRATOR,
    ],
    [StaffDepartment.HR]: [
      StaffPosition.HR_MANAGER,
      StaffPosition.HR_OFFICER,
      StaffPosition.RECRUITMENT_SPECIALIST,
    ],
    [StaffDepartment.ADMIN]: [
      StaffPosition.ADMIN,
      StaffPosition.ADMIN_ASSISTANT,
      StaffPosition.DATA_CAPTURER,
    ],
    [StaffDepartment.LOGISTICS]: [
      StaffPosition.LOGISTICS_COORDINATOR,
      StaffPosition.DRIVER,
    ],
  };

  return departmentPositions[department] || [];
}