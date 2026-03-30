/**
 * CSV Processor
 * Handles CSV file parsing and processing
 */

import { StaffImportRow, StaffImportResult } from '@/types/staff.types';
import { getFieldNameFromHeader } from './types';
import { processImportRows } from './rowProcessor';
import { log } from '@/lib/logger';

/**
 * Import staff from CSV file
 */
export async function importFromCSV(file: File, overwriteExisting: boolean = true): Promise<StaffImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());

        if (lines.length === 0) {
          reject(new Error('CSV file is empty'));
          return;
        }

        const headerLine = lines[0];
        if (!headerLine) {
          reject(new Error('CSV file has no header row'));
          return;
        }

        const headers = headerLine.split(',').map(h => h.trim());
        const mappedHeaders = headers.map(h => getFieldNameFromHeader(h));

        log.info('CSV header mapping:', { data: headers.map((h, i) => `${h} -> ${mappedHeaders[i]}`) }, 'csvProcessor');

        const rows: StaffImportRow[] = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const values = line.split(',').map(v => v.trim());
          const row: Record<string, string> = {};
          let firstName = '';
          let lastName = '';

          mappedHeaders.forEach((fieldName, index) => {
            row[fieldName] = values[index] || '';

            // Track firstName/lastName for name combination
            if (fieldName === 'firstName') firstName = values[index] || '';
            if (fieldName === 'lastName') lastName = values[index] || '';
          });

          // Combine firstName + lastName into name if no name field
          if (!row['name'] && (firstName || lastName)) {
            row['name'] = `${firstName} ${lastName}`.trim();
          }

          rows.push({
            employeeId: row['employeeId'] || '',
            name: row['name'] || '',
            email: row['email'] || '',
            phone: row['phone'] || '',
            position: row['position'] || 'Staff',
            department: row['department'] || 'Operations',
            managerName: row['managerName'] || '',
            skills: row['skills'] || '',
            alternativePhone: row['alternativePhone'] || '',
            address: row['address'] || '',
            city: row['city'] || '',
            province: row['province'] || '',
            postalCode: row['postalCode'] || '',
            emergencyContactName: row['emergencyContactName'] || '',
            emergencyContactPhone: row['emergencyContactPhone'] || '',
            startDate: row['startDate'] || '',
            contractType: row['contractType'] || '',
            workingHours: row['workingHours'] || '',
            idNumber: row['idNumber'] || '',
            salary: row['salary'] || '',
          });
        }

        log.info(`Processing ${rows.length} rows from CSV`, undefined, 'csvProcessor');

        const result = await processImportRows(rows, overwriteExisting);
        resolve(result);
      } catch (error) {
        log.error('CSV import failed:', { data: error }, 'csvProcessor');
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read CSV file'));
    reader.readAsText(file);
  });
}
