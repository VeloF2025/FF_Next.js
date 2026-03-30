/**
 * Staff Data Validators
 * Validation and processing functions for staff data
 */

import { StaffFormData } from '@/types/staff.types';
import { log } from '@/lib/logger';

/**
 * Validate required fields for staff creation
 */
export function validateStaffData(data: StaffFormData): void {
  if (!data.employeeId || data.employeeId.trim() === '') {
    throw new Error('Employee ID is required and cannot be empty');
  }
  
  if (!data.name || data.name.trim() === '') {
    throw new Error('Name is required and cannot be empty');
  }
  
  if (!data.email || data.email.trim() === '') {
    throw new Error('Email is required and cannot be empty');
  }
}

/**
 * Process reportsTo field to ensure proper UUID handling
 */
export function processReportsToField(reportsTo: string | undefined | null): string | null {
  // ULTRA-SAFE UUID PROCESSING - Multiple validation layers
  let processedReportsTo: string | null = null;

  // Step 1: Check if reportsTo exists and is not undefined/null
  if (reportsTo !== undefined && reportsTo !== null) {

    // Step 2: Convert to string and check if not empty
    const reportsToString = String(reportsTo).trim();

    // Step 3: Validate it's a non-empty string
    if (reportsToString !== '' && reportsToString !== 'undefined' && reportsToString !== 'null') {

      processedReportsTo = reportsToString;
    } else {

      processedReportsTo = null;
    }
  } else {

    processedReportsTo = null;
  }


  // TRIPLE CHECK - Absolutely ensure no empty strings
  if (processedReportsTo === '') {

    processedReportsTo = null;
  }
  
  return processedReportsTo;
}

/**
 * Log debug information for staff data
 */
export function logDebugInfo(_operation: string, data: any, reportsTo?: any): void {

  log.info('1. Raw input data:', { data: JSON.stringify(data, null, 2) }, 'validators');
  
  if (reportsTo !== undefined) {



    log.info('   - String representation:', { data: String(reportsTo) }, 'validators');
    log.info('   - JSON stringify:', { data: JSON.stringify(reportsTo) }, 'validators');



    log.info('   - Trimmed length:', { data: reportsTo ? String(reportsTo).length : 'N/A' }, 'validators');
  }
}

/**
 * Log error information
 */
export function logError(operation: string, error: unknown, data: any): void {
  log.error(`❌ ${operation} ERROR - Detailed error info:`, { data: {
    message: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : 'No stack trace',
    inputData: data,
    processedData: {
      employeeId: data.employeeId,
      reportsTo: data.reportsTo
    }
  } }, 'validators');
}