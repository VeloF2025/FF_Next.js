import * as XLSX from 'xlsx';
import { StaffMember } from '@/types/staff.types';
import { staffNeonService } from './staffNeonService';
import { formatDisplayDate } from '@/utils/dateFormat';
import type { StaffAccessResult } from '@/types/staff/access.types';

/**
 * Export and template generation for staff
 */
export const staffExportService = {
  /**
   * Export staff to Excel file
   * @param staff - Staff data to export (or fetches all if not provided)
   * @param access - Access level to determine which columns to include
   */
  async exportToExcel(staff?: StaffMember[], access?: StaffAccessResult): Promise<Blob> {
    // Get all staff if not provided
    const dataToExport = staff || await staffNeonService.getAll();

    // Base export data - visible to all users
    const exportData = dataToExport.map(s => {
      const baseData: Record<string, string | number> = {
        'Employee ID': s.employeeId,
        'Name': s.name,
        'Email': s.email,
        'Phone': s.phone,
        'Alternative Phone': s.alternativePhone || '',
        'Position': s.position,
        'Department': s.department,
        'Level': s.level,
        'Status': s.status,
        'Manager': s.managerName || '',
        'Skills': s.skills.join(', '),
        'Experience Years': s.experienceYears,
        'Address': s.address,
        'City': s.city,
        'Province': s.province,
        'Postal Code': s.postalCode,
        'Start Date': s.startDate ? formatDisplayDate(s.startDate, '') : '',
        'Contract Type': s.contractType,
        'Working Hours': s.workingHours,
        'Available Weekends': s.availableWeekends ? 'Yes' : 'No',
        'Available Nights': s.availableNights ? 'Yes' : 'No',
        'Current Projects': s.currentProjectCount,
        'Max Projects': s.maxProjectCount,
        'Projects Completed': s.totalProjectsCompleted,
        'Average Rating': s.averageProjectRating,
        'On-Time Completion Rate': `${s.onTimeCompletionRate}%`
      };

      // Add sensitive columns only if user has access
      if (access?.canViewSensitive) {
        Object.assign(baseData, {
          'Emergency Contact Name': s.emergencyContactName || '',
          'Emergency Contact Phone': s.emergencyContactPhone || '',
          'Salary': (s as any).salaryAmount || '',
          'Hourly Rate': (s as any).hourlyRate || '',
          'Salary Grade': (s as any).salaryGrade || '',
          'SA ID Number': (s as any).saIdNumber || '',
          'Passport Number': (s as any).passportNumber || '',
          'Tax Number': (s as any).taxNumber || '',
          'UIF Number': (s as any).uifNumber || '',
          'Bank Name': (s as any).bankName || '',
          'Bank Account': (s as any).bankAccountNumber || '',
          'Bank Branch': (s as any).bankBranchCode || '',
          'Next of Kin Name': (s as any).nextOfKinName || '',
          'Next of Kin Phone': (s as any).nextOfKinPhone || '',
        });
      }

      return baseData;
    });
    
    // Create workbook
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Staff');
    
    // Auto-size columns
    const colWidths = [
      { wch: 15 }, // Employee ID
      { wch: 25 }, // Name
      { wch: 30 }, // Email
      { wch: 15 }, // Phone
      { wch: 15 }, // Alternative Phone
      { wch: 20 }, // Position
      { wch: 15 }, // Department
      { wch: 12 }, // Level
      { wch: 10 }, // Status
      { wch: 25 }, // Manager
      { wch: 40 }, // Skills
      { wch: 10 }, // Experience Years
      { wch: 30 }, // Address
      { wch: 15 }, // City
      { wch: 12 }, // Province
      { wch: 10 }, // Postal Code
      { wch: 25 }, // Emergency Contact Name
      { wch: 15 }, // Emergency Contact Phone
      { wch: 12 }, // Start Date
      { wch: 12 }, // Contract Type
      { wch: 15 }, // Working Hours
      { wch: 10 }, // Available Weekends
      { wch: 10 }, // Available Nights
      { wch: 10 }, // Current Projects
      { wch: 10 }, // Max Projects
      { wch: 10 }, // Projects Completed
      { wch: 10 }, // Average Rating
      { wch: 15 }, // On-Time Completion Rate
    ];
    ws['!cols'] = colWidths;
    
    // Generate Excel file
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
  },

  /**
   * Download template Excel file for import
   */
  getImportTemplate(): Blob {
    const templateData = [
      {
        'name': 'John Doe',
        'email': 'john.doe@example.com',
        'phone': '0821234567',
        'alternativePhone': '0119876543',
        'employeeId': 'EMP001',
        'position': 'Senior Technician',
        'department': 'engineering',
        'level': 'senior',
        'status': 'active',
        'skills': 'fiber_splicing,otdr_testing,troubleshooting',
        'address': '123 Main Street',
        'city': 'Johannesburg',
        'province': 'Gauteng',
        'postalCode': '2000',
        'emergencyContactName': 'Jane Doe',
        'emergencyContactPhone': '0829876543',
        'startDate': '01/01/2023',
        'endDate': '',
        'contractType': 'permanent',
        'workingHours': '08:00 - 17:00'
      }
    ];
    
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Staff Import Template');
    
    // Add instructions sheet
    const instructions = [
      { 'Field': 'name', 'Required': 'Yes', 'Description': 'Full name of the staff member' },
      { 'Field': 'email', 'Required': 'Yes', 'Description': 'Email address (must be unique)' },
      { 'Field': 'phone', 'Required': 'Yes', 'Description': 'Primary phone number' },
      { 'Field': 'alternativePhone', 'Required': 'No', 'Description': 'Alternative contact number' },
      { 'Field': 'employeeId', 'Required': 'No', 'Description': 'Employee ID (auto-generated if empty)' },
      { 'Field': 'position', 'Required': 'No', 'Description': 'Job title or position' },
      { 'Field': 'department', 'Required': 'No', 'Description': 'Department: management, engineering, installation, maintenance, sales, operations, etc.' },
      { 'Field': 'level', 'Required': 'No', 'Description': 'Level: intern, junior, intermediate, senior, lead, manager, etc.' },
      { 'Field': 'status', 'Required': 'No', 'Description': 'Status: active, inactive, on_leave, suspended, terminated' },
      { 'Field': 'skills', 'Required': 'No', 'Description': 'Comma-separated skills: fiber_splicing, otdr_testing, cable_installation, etc.' },
      { 'Field': 'address', 'Required': 'No', 'Description': 'Street address' },
      { 'Field': 'city', 'Required': 'No', 'Description': 'City' },
      { 'Field': 'province', 'Required': 'No', 'Description': 'Province' },
      { 'Field': 'postalCode', 'Required': 'No', 'Description': 'Postal code' },
      { 'Field': 'emergencyContactName', 'Required': 'No', 'Description': 'Emergency contact person name' },
      { 'Field': 'emergencyContactPhone', 'Required': 'No', 'Description': 'Emergency contact phone number' },
      { 'Field': 'startDate', 'Required': 'No', 'Description': 'Employment start date (DD/MM/YYYY)' },
      { 'Field': 'endDate', 'Required': 'No', 'Description': 'Employment end date (DD/MM/YYYY) - leave empty for active employees' },
      { 'Field': 'contractType', 'Required': 'No', 'Description': 'Contract type: permanent, contract, temporary, freelance, intern' },
      { 'Field': 'workingHours', 'Required': 'No', 'Description': 'Working hours (e.g., 08:00 - 17:00)' }
    ];
    
    const wsInstructions = XLSX.utils.json_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');
    
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
  }
};