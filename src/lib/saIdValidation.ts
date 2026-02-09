/**
 * South African ID Number Validation
 * Pure function - no external dependencies
 *
 * SA ID format: YYMMDD SSSS C A Z
 * - YYMMDD: Date of birth
 * - SSSS: Gender (0000-4999 = female, 5000-9999 = male)
 * - C: Citizenship (0 = SA citizen, 1 = permanent resident)
 * - A: Usually 8 (was used for race classification, now deprecated)
 * - Z: Luhn checksum digit
 */

import type { SaIdValidationResult } from '@/types/contractor-verification.types';

export function validateSaId(idNumber: string): SaIdValidationResult {
  const errors: string[] = [];
  const cleaned = idNumber.replace(/\s/g, '');

  if (cleaned.length !== 13) {
    errors.push('ID number must be exactly 13 digits');
    return { isValid: false, dateOfBirth: null, gender: null, citizenship: null, errors };
  }

  if (!/^\d{13}$/.test(cleaned)) {
    errors.push('ID number must contain only digits');
    return { isValid: false, dateOfBirth: null, gender: null, citizenship: null, errors };
  }

  // Extract date of birth
  const yearPart = parseInt(cleaned.substring(0, 2), 10);
  const month = parseInt(cleaned.substring(2, 4), 10);
  const day = parseInt(cleaned.substring(4, 6), 10);

  // Determine century: if year > current 2-digit year, assume 1900s
  const currentYear = new Date().getFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;
  const currentTwoDigit = currentYear % 100;
  const fullYear = yearPart > currentTwoDigit ? 1900 + yearPart : currentCentury + yearPart;

  // Validate month
  if (month < 1 || month > 12) {
    errors.push(`Invalid month: ${month}`);
  }

  // Validate day (accounting for leap years and month lengths)
  let dateOfBirth: string | null = null;
  if (month >= 1 && month <= 12) {
    const daysInMonth = new Date(fullYear, month, 0).getDate();
    if (day < 1 || day > daysInMonth) {
      errors.push(`Invalid day ${day} for month ${month}`);
    } else {
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      dateOfBirth = `${fullYear}-${mm}-${dd}`;
    }
  }

  // Validate date is not in the future
  if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    if (dob > new Date()) {
      errors.push('Date of birth is in the future');
    }
  }

  // Extract gender (digits 7-10, 0-based index 6-9)
  const genderDigits = parseInt(cleaned.substring(6, 10), 10);
  const gender: 'male' | 'female' = genderDigits >= 5000 ? 'male' : 'female';

  // Extract citizenship (digit 11, 0-based index 10)
  const citizenshipDigit = parseInt(cleaned[10], 10);
  let citizenship: 'sa_citizen' | 'permanent_resident' | null = null;
  if (citizenshipDigit === 0) {
    citizenship = 'sa_citizen';
  } else if (citizenshipDigit === 1) {
    citizenship = 'permanent_resident';
  } else {
    errors.push(`Invalid citizenship digit: ${citizenshipDigit}`);
  }

  // Luhn checksum validation
  if (!luhnCheck(cleaned)) {
    errors.push('Invalid checksum (Luhn check failed)');
  }

  return {
    isValid: errors.length === 0,
    dateOfBirth,
    gender: errors.length === 0 ? gender : null,
    citizenship: errors.length === 0 ? citizenship : null,
    errors,
  };
}

function luhnCheck(idNumber: string): boolean {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let digit = parseInt(idNumber[i], 10);
    // Double every second digit from the right (0-indexed: positions 11, 9, 7, 5, 3, 1)
    if ((13 - i) % 2 === 0) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
