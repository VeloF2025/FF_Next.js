/**
 * Row Processor
 * Processes imported rows and creates/updates staff records
 */

import {
  StaffImportRow,
  StaffImportResult,
  StaffImportError,
  StaffFormData,
  StaffMember,
  StaffStatus
} from '@/types/staff.types';
import { extractUniqueManagers, sortByManagerHierarchy, findManagerByName } from './managerResolver';
import { parseDate, parseSkills, parseContractType } from './parsers';
import { log } from '@/lib/logger';

/**
 * Process imported rows and create/update staff
 */
export async function processImportRows(
  rows: StaffImportRow[], 
  _overwriteExisting: boolean = true
): Promise<StaffImportResult> {
  const { staffService } = await import('../../staffService');
  const errors: StaffImportError[] = [];
  const importedStaff = [];
  let successful = 0;
  let failed = 0;
  // const skipped = 0; // Not used in current implementation
  
  // Extract all manager names first
  const managerNames = extractUniqueManagers(rows);
  log.info('📊 Unique managers found:', { data: Array.from(managerNames) }, 'rowProcessor');
  
  // Sort rows to process managers first
  const sortedRows = sortByManagerHierarchy(rows, managerNames);

  for (let i = 0; i < sortedRows.length; i++) {
    const row = sortedRows[i];
    const originalIndex = rows.indexOf(row);
    const rowNumber = originalIndex + 2; // +2 because row 1 is headers, and arrays are 0-indexed
    
    try {
      // Debug: Show what we're validating
      if (rowNumber <= 5) { // Only log first few rows

      }
      
      // Validate required fields
      if (!row.name || row.name.trim() === '') {

        errors.push({
          row: rowNumber,
          field: 'name',
          message: 'Name is required'
        });
        failed++;
        continue;
      }
      
      if (!row.email || row.email.trim() === '') {
        errors.push({
          row: rowNumber,
          field: 'email',
          message: 'Email is required'
        });
        failed++;
        continue;
      }
      
      if (!row.phone || row.phone.trim() === '') {
        errors.push({
          row: rowNumber,
          field: 'phone',
          message: 'Phone is required'
        });
        failed++;
        continue;
      }
      
      // Validate employeeId - this is critical for database constraint
      if (!row.employeeId || row.employeeId.trim() === '') {
        log.info(`Row ${rowNumber} missing employeeId. Available fields:`, { data: Object.keys(row) }, 'rowProcessor');

        errors.push({
          row: rowNumber,
          field: 'employeeId',
          message: 'Employee ID is required'
        });
        failed++;
        continue;
      }
      
      // Handle manager name to UUID conversion by looking up existing staff
      let reportsTo: string | undefined = undefined;
      if (row.managerName && row.managerName.trim() && row.managerName.trim() !== '') {
        const managerName = row.managerName.trim();

        try {
          // Look up manager by name in existing staff
          const managerUuid = await findManagerByName(managerName);
          if (managerUuid) {
            reportsTo = managerUuid;
          } else {
            // No manager found by name; leave reportsTo as null
          }
        } catch (error) {
          log.warn('rowProcessor', { action: 'managerLookupFailed', managerName, error });
        }
      } else {
        // No manager name provided; leave reportsTo as null
      }
      
      // Ensure employeeId is never null or empty
      const employeeId = row.employeeId && row.employeeId.trim() !== '' 
        ? row.employeeId.trim() 
        : `AUTO_${Date.now()}_${i}`;

      // COMPREHENSIVE DEBUG LOGGING - IMPORT SERVICE TRACING


      log.info('Manager lookup result:', { data: {
        managerName: row.managerName,
        resolvedUuid: reportsTo,
        reportsToType: typeof reportsTo,
        reportsToValue: JSON.stringify(reportsTo)
      } }, 'rowProcessor');
      
      // Parse start date if provided
      let startDate = new Date();
      if (row.startDate) {
        const parsedDate = parseDate(row.startDate);
        if (parsedDate) {
          startDate = parsedDate;
        }
      }
      
      // Create staff form data that matches StaffFormData interface
      const parsedContractType = parseContractType(row.contractType);
      const formData: StaffFormData = {
        name: row.name.trim(),
        email: row.email.trim(),
        phone: row.phone.trim() || '',
        ...(row.alternativePhone && { alternativePhone: row.alternativePhone }),
        employeeId: employeeId,
        ...(row.idNumber && { idNumber: row.idNumber }), // SA ID Number
        position: row.position || 'Staff',
        department: row.department || 'Operations',
        saContractType: parsedContractType, // SA-compliant contract type
        contractType: parsedContractType as unknown as import('@/types/staff/enums.types').ContractType, // Legacy field
        status: StaffStatus.ACTIVE, // Default status
        ...(reportsTo && { reportsTo }), // Only include if manager found
        startDate: startDate, // Use parsed date
        address: row.address || '',
        city: row.city || '',
        province: row.province || '',
        postalCode: row.postalCode || '',
        ...(row.emergencyContactName && { emergencyContactName: row.emergencyContactName }),
        ...(row.emergencyContactPhone && { emergencyContactPhone: row.emergencyContactPhone }),
        ...(row.salary && { salaryAmount: parseFloat(row.salary) || undefined }),
        experienceYears: 0,
        workingHours: row.workingHours || "9:00-17:00",
        availableWeekends: false,
        availableNights: false,
        timeZone: "Africa/Johannesburg",
        maxProjectCount: 5,
        skills: parseSkills(row.skills),
      };
      
      // Import the staff member using createOrUpdate to handle both new and existing
      log.info(`📝 Creating or updating staff member: ${formData.name} (Employee ID: ${formData.employeeId})`, undefined, 'rowProcessor');
      const staffMember = await staffService.createOrUpdate(formData as unknown as Partial<StaffMember>);
      
      if (staffMember) {
        importedStaff.push(staffMember);
        successful++;

      } else {
        failed++;
        errors.push({
          row: rowNumber,
          field: '',
          message: 'Failed to create/update staff member'
        });
      }
    } catch (error) {
      log.error(`❌ Error processing row ${rowNumber}:`, { data: error }, 'rowProcessor');
      failed++;
      errors.push({
        row: rowNumber,
        field: '',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  }
  
  return {
    success: failed === 0,
    total: rows.length,
    imported: successful,
    failed,
    errors,
    staffMembers: importedStaff
  };
}