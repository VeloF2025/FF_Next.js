/**
 * Staff Import Service Module
 * Central exports for staff import/export operations
 */

import { importFromCSV } from './csvProcessor';
import { importFromExcel, exportToExcel } from './excelProcessor';
import { IMPORT_TEMPLATE_COLUMNS } from './types';

/**
 * Import/Export operations for staff
 */
export const staffImportService = {
  /**
   * Import staff from CSV file
   */
  importFromCSV,

  /**
   * Import staff from Excel file
   */
  importFromExcel,

  /**
   * Export staff to Excel file
   */
  exportToExcel,

  /**
   * Get CSV template for import
   */
  getImportTemplate(): string {
    return IMPORT_TEMPLATE_COLUMNS.join(',');
  }
};

// Export all sub-modules for direct access if needed
export * from './types';
export * from './parsers';
export * from './managerResolver';
export * from './csvProcessor';
export * from './excelProcessor';
export * from './rowProcessor';