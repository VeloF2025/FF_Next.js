/**
 * Format Detection Module
 * Automatically detects data types and formats from sample data
 */

import { DataType, FormatDetectionResult } from './parser-types';

/**
 * Detect data type from sample values
 */
export function detectDataType(samples: unknown[]): FormatDetectionResult {
  if (!samples || samples.length === 0) {
    return {
      type: 'unknown',
      confidence: 0,
      samples: []
    };
  }

  const validSamples = samples.filter(s => s !== null && s !== undefined && s !== '');
  
  if (validSamples.length === 0) {
    return {
      type: 'string',
      confidence: 0.1,
      samples: validSamples
    };
  }

  // Test for different data types
  const typeTests = [
    { type: 'number', test: isNumberFormat, confidence: 0 },
    { type: 'date', test: isDateFormat, confidence: 0 },
    { type: 'boolean', test: isBooleanFormat, confidence: 0 },
    { type: 'email', test: isEmailFormat, confidence: 0 },
    { type: 'phone', test: isPhoneFormat, confidence: 0 }
  ];

  // Calculate confidence for each type
  typeTests.forEach(typeTest => {
    let matches = 0;
    validSamples.forEach(sample => {
      if (typeTest.test(sample)) {
        matches++;
      }
    });
    typeTest.confidence = matches / validSamples.length;
  });

  // Find the type with highest confidence
  const bestMatch = typeTests.reduce((best, current) => 
    current.confidence > best.confidence ? current : best
  );

  // If no type has high confidence, default to string
  if (bestMatch.confidence < 0.6) {
    return {
      type: 'string',
      confidence: 1.0,
      samples: validSamples
    };
  }

  return {
    type: bestMatch.type as DataType,
    confidence: bestMatch.confidence,
    samples: validSamples,
    commonFormats: detectCommonFormats(validSamples, bestMatch.type as DataType)
  };
}

/**
 * Test if value looks like a number
 */
export function isNumberFormat(value: unknown): boolean {
  if (typeof value === 'number') {
    return !isNaN(value);
  }

  if (typeof value === 'string') {
    // Remove common formatting characters
    const cleaned = value.replace(/[$,\s%]/g, '');
    const parsed = parseFloat(cleaned);
    return !isNaN(parsed) && cleaned !== '';
  }

  return false;
}

/**
 * Test if value looks like a date
 */
export function isDateFormat(value: unknown): boolean {
  if (value instanceof Date) {
    return !isNaN(value.getTime());
  }

  if (typeof value === 'string') {
    // Common date patterns
    const datePatterns = [
      /^\d{1,2}\/\d{1,2}\/\d{4}$/, // MM/DD/YYYY
      /^\d{4}-\d{1,2}-\d{1,2}$/, // YYYY-MM-DD
      /^\d{1,2}-\d{1,2}-\d{4}$/, // MM-DD-YYYY
      /^\d{1,2}\.\d{1,2}\.\d{4}$/, // DD.MM.YYYY
      /^\d{4}\/\d{1,2}\/\d{1,2}$/ // YYYY/MM/DD
    ];

    if (datePatterns.some(pattern => pattern.test(value))) {
      const date = new Date(value);
      return !isNaN(date.getTime());
    }

    // Try parsing as ISO date
    const isoDate = new Date(value);
    return !isNaN(isoDate.getTime());
  }

  if (typeof value === 'number') {
    // Timestamp validation (reasonable range)
    const date = new Date(value);
    return !isNaN(date.getTime()) && value > 0;
  }

  return false;
}

/**
 * Test if value looks like a boolean
 */
export function isBooleanFormat(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    const booleanValues = [
      'true', 'false', 'yes', 'no', '1', '0', 
      'on', 'off', 'active', 'inactive', 
      'enabled', 'disabled', 'y', 'n'
    ];
    return booleanValues.includes(normalized);
  }

  if (typeof value === 'number') {
    return value === 0 || value === 1;
  }

  return false;
}

/**
 * Test if value looks like an email
 */
export function isEmailFormat(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value.trim());
}

/**
 * Test if value looks like a phone number
 */
export function isPhoneFormat(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return false;
  }

  const stringValue = String(value).replace(/\D/g, '');
  return stringValue.length >= 10 && stringValue.length <= 15;
}

/**
 * Detect common formats within a data type
 */
export function detectCommonFormats(samples: unknown[], dataType: DataType): string[] {
  const formats: string[] = [];

  switch (dataType) {
    case 'date': {
      const dateFormats = new Set<string>();
      samples.forEach(sample => {
        if (typeof sample === 'string') {
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sample)) {
            dateFormats.add('MM/DD/YYYY');
          } else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(sample)) {
            dateFormats.add('YYYY-MM-DD');
          } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(sample)) {
            dateFormats.add('MM-DD-YYYY');
          } else if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(sample)) {
            dateFormats.add('DD.MM.YYYY');
          }
        }
      });
      formats.push(...Array.from(dateFormats));
      break;
    }

    case 'number': {
      const numberFormats = new Set<string>();
      samples.forEach(sample => {
        if (typeof sample === 'string') {
          if (sample.includes(',')) numberFormats.add('comma-separated');
          if (sample.includes('$')) numberFormats.add('currency');
          if (sample.includes('%')) numberFormats.add('percentage');
          if (/^\d+\.\d{2}$/.test(sample.replace(/[,$]/g, ''))) {
            numberFormats.add('decimal-2');
          }
        }
      });
      formats.push(...Array.from(numberFormats));
      break;
    }

    case 'phone': {
      const phoneFormats = new Set<string>();
      samples.forEach(sample => {
        const phoneStr = String(sample);
        if (/^\(\d{3}\)\s\d{3}-\d{4}$/.test(phoneStr)) {
          phoneFormats.add('(XXX) XXX-XXXX');
        } else if (/^\d{3}-\d{3}-\d{4}$/.test(phoneStr)) {
          phoneFormats.add('XXX-XXX-XXXX');
        } else if (/^\d{10}$/.test(phoneStr.replace(/\D/g, ''))) {
          phoneFormats.add('XXXXXXXXXX');
        }
      });
      formats.push(...Array.from(phoneFormats));
      break;
    }
  }

  return formats;
}

/**
 * Analyze data consistency across samples
 */
export function analyzeDataConsistency(samples: unknown[]): {
  consistency: number;
  inconsistentSamples: unknown[];
  commonPattern: RegExp | undefined;
} {
  if (!samples || samples.length === 0) {
    return { consistency: 0, inconsistentSamples: [], commonPattern: undefined };
  }

  const validSamples = samples.filter(s => s !== null && s !== undefined && s !== '');
  
  if (validSamples.length === 0) {
    return { consistency: 0, inconsistentSamples: [], commonPattern: undefined };
  }

  // Detect the most common type
  const typeResult = detectDataType(validSamples);
  
  // Check how many samples match the detected type
  let consistentCount = 0;
  const inconsistentSamples: unknown[] = [];

  validSamples.forEach(sample => {
    let isConsistent = false;
    
    switch (typeResult.type) {
      case 'number':
        isConsistent = isNumberFormat(sample);
        break;
      case 'date':
        isConsistent = isDateFormat(sample);
        break;
      case 'boolean':
        isConsistent = isBooleanFormat(sample);
        break;
      case 'email':
        isConsistent = isEmailFormat(sample);
        break;
      case 'phone':
        isConsistent = isPhoneFormat(sample);
        break;
      default:
        isConsistent = true; // String type accepts anything
    }

    if (isConsistent) {
      consistentCount++;
    } else {
      inconsistentSamples.push(sample);
    }
  });

  return {
    consistency: consistentCount / validSamples.length,
    inconsistentSamples,
    commonPattern: generateCommonPattern(validSamples, typeResult.type)
  };
}

/**
 * Generate a regex pattern for common data formats
 */
function generateCommonPattern(samples: unknown[], dataType: DataType): RegExp | undefined {
  // Use samples to create more specific patterns
  const validSamples = samples.filter(s => s != null && s !== '').slice(0, 10);
  
  switch (dataType) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    case 'phone': {
      // Check if samples contain common phone separators
      const hasParens = validSamples.some(s => String(s).includes('('));
      const hasDashes = validSamples.some(s => String(s).includes('-'));
      const hasDots = validSamples.some(s => String(s).includes('.'));
      let phonePattern = '^[\\d\\s';
      if (hasParens) phonePattern += '()';
      if (hasDashes) phonePattern += '-';
      if (hasDots) phonePattern += '.';
      phonePattern += ']+$';
      return new RegExp(phonePattern);
    }
    case 'date':
      return /^[\d/\-.s:]+$/;
    case 'number': {
      // Analyze samples for common number formats
      const hasCommas = validSamples.some(s => String(s).includes(','));
      const hasDollars = validSamples.some(s => String(s).includes('$'));
      const hasPercent = validSamples.some(s => String(s).includes('%'));
      let numberPattern = '^[\\d.\\s+-';
      if (hasCommas) numberPattern += ',';
      if (hasDollars) numberPattern += '$';
      if (hasPercent) numberPattern += '%';
      numberPattern += ']+$';
      return new RegExp(numberPattern);
    }
    default:
      return undefined;
  }
}