/**
 * Excel Import Engine - Column Mapping Logic
 * Handles intelligent mapping of Excel columns to BOQ item fields
 */

import { ColumnMapping, DEFAULT_COLUMN_MAPPING, ParsedBOQItem } from './importTypes';
import { parseNumber, validateString } from './importValidation';
import { ImportError, ImportWarning } from './validation/modules/validation-types';

/**
 * Map raw row data to BOQ item structure using column mapping configuration
 */
export function mapRowToBoqItem(
  row: Record<string, unknown>,
  rowIndex: number,
  columnMapping: ColumnMapping,
  errors: ImportError[],
  warnings: ImportWarning[]
): Partial<ParsedBOQItem> {
  const rowNumber = rowIndex + 1;
  
  // Find the best matching column for each field
  const mappedData: Partial<ParsedBOQItem> = {
    rawData: { ...row }
  };

  // Map line number
  const lineNumberValue = findColumnValue(row, columnMapping.lineNumber);
  mappedData.lineNumber = parseNumber(lineNumberValue, rowNumber, 'lineNumber', errors, warnings, false) ?? rowNumber;

  // Map item code
  const itemCodeValue = findColumnValue(row, columnMapping.itemCode);
  const itemCodeResult = validateString(itemCodeValue, rowNumber, 'itemCode', errors, warnings, 100, false); if (itemCodeResult) mappedData.itemCode = itemCodeResult;

  // Map description (required)
  const descriptionValue = findColumnValue(row, columnMapping.description);
  mappedData.description = validateString(descriptionValue, rowNumber, 'description', errors, warnings, 500, true) ?? '';

  // Map category
  const categoryValue = findColumnValue(row, columnMapping.category);
  const categoryResult = validateString(categoryValue, rowNumber, 'category', errors, warnings, 100, false); if (categoryResult) mappedData.category = categoryResult;

  // Map quantity (required)
  const quantityValue = findColumnValue(row, columnMapping.quantity);
  const parsedQuantity = parseNumber(quantityValue, rowNumber, 'quantity', errors, warnings, true);
  mappedData.quantity = parsedQuantity ?? 0;

  // Map unit of measure (required)
  const uomValue = findColumnValue(row, columnMapping.uom);
  mappedData.uom = validateString(uomValue, rowNumber, 'uom', errors, warnings, 20, true) ?? '';

  // Map unit price
  const unitPriceValue = findColumnValue(row, columnMapping.unitPrice);
  const unitPriceResult = parseNumber(unitPriceValue, rowNumber, 'unitPrice', errors, warnings, false); if (unitPriceResult !== null && unitPriceResult !== undefined) mappedData.unitPrice = unitPriceResult;

  // Map total price
  const totalPriceValue = findColumnValue(row, columnMapping.totalPrice);
  const totalPriceResult = parseNumber(totalPriceValue, rowNumber, 'totalPrice', errors, warnings, false); if (totalPriceResult !== null && totalPriceResult !== undefined) mappedData.totalPrice = totalPriceResult;

  // Map phase
  const phaseValue = findColumnValue(row, columnMapping.phase);
  const phaseResult = validateString(phaseValue, rowNumber, 'phase', errors, warnings, 100, false); if (phaseResult) mappedData.phase = phaseResult;

  // Map task
  const taskValue = findColumnValue(row, columnMapping.task);
  const taskResult = validateString(taskValue, rowNumber, 'task', errors, warnings, 100, false); if (taskResult) mappedData.task = taskResult;

  // Map site/location
  const siteValue = findColumnValue(row, columnMapping.site) || findColumnValue(row, columnMapping.location);
  const siteResult = validateString(siteValue, rowNumber, 'site', errors, warnings, 100, false); if (siteResult) mappedData.site = siteResult;

  return mappedData;
}

/**
 * Find the best matching column value from available options
 */
function findColumnValue(row: Record<string, unknown>, possibleColumns: string[]): unknown {
  const rowKeys = Object.keys(row).map(key => key.toLowerCase().trim());
  
  for (const column of possibleColumns) {
    const normalizedColumn = column.toLowerCase().trim();
    
    // Exact match first
    const exactMatch = rowKeys.find(key => key === normalizedColumn);
    if (exactMatch && row[Object.keys(row)[rowKeys.indexOf(exactMatch)]!] !== undefined) {
      return row[Object.keys(row)[rowKeys.indexOf(exactMatch)]!];
    }
    
    // Partial match (contains)
    const partialMatch = rowKeys.find(key => 
      key.includes(normalizedColumn) || normalizedColumn.includes(key)
    );
    if (partialMatch && row[Object.keys(row)[rowKeys.indexOf(partialMatch)]!] !== undefined) {
      return row[Object.keys(row)[rowKeys.indexOf(partialMatch)]!];
    }
  }
  
  return undefined;
}

/**
 * Automatically detect column mapping from header row
 */
export function detectColumnMapping(headers: string[]): {
  mapping: Partial<ColumnMapping>;
  confidence: number;
  suggestions: Array<{ field: string; detectedColumn: string; confidence: number }>;
} {
  const detectedMapping: Partial<ColumnMapping> = {};
  const suggestions: Array<{ field: string; detectedColumn: string; confidence: number }> = [];
  let totalConfidence = 0;
  let matchedFields = 0;

  const normalizedHeaders = headers.map(header => header.toLowerCase().trim());

  // Iterate through each field we want to map
  Object.entries(DEFAULT_COLUMN_MAPPING).forEach(([fieldName, possibleColumns]) => {
    let bestMatch: { header: string; confidence: number } | null = null;

    possibleColumns.forEach((possibleColumn: string) => {
      const normalizedPossible = possibleColumn.toLowerCase().trim();

      normalizedHeaders.forEach((header, index) => {
        let confidence = 0;

        // Exact match gets highest confidence
        if (header === normalizedPossible) {
          confidence = 1.0;
        }
        // Contains match gets lower confidence
        else if (header.includes(normalizedPossible)) {
          confidence = 0.8;
        }
        // Reverse contains (possible contains header)
        else if (normalizedPossible.includes(header) && header.length > 2) {
          confidence = 0.7;
        }
        // Fuzzy match based on common words
        else {
          confidence = calculateFuzzyMatch(header, normalizedPossible);
        }

        if (confidence > 0.5 && (!bestMatch || confidence > bestMatch.confidence)) {
          bestMatch = { header: headers[index]!, confidence };
        }
      });
    });

    if (bestMatch !== null) {
      const match = bestMatch as { header: string; confidence: number };
      detectedMapping[fieldName as keyof ColumnMapping] = [match.header];
      suggestions.push({
        field: fieldName,
        detectedColumn: match.header,
        confidence: match.confidence
      });
      totalConfidence += match.confidence;
      matchedFields++;
    }
  });

  const overallConfidence = matchedFields > 0 ? totalConfidence / matchedFields : 0;

  return {
    mapping: detectedMapping,
    confidence: overallConfidence,
    suggestions
  };
}

/**
 * Calculate fuzzy matching score between two strings
 */
function calculateFuzzyMatch(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  // Split into words and check overlap
  const words1 = str1.split(/[\s_-]+/).filter(w => w.length > 1);
  const words2 = str2.split(/[\s_-]+/).filter(w => w.length > 1);

  if (words1.length === 0 || words2.length === 0) return 0;

  let matches = 0;
  words1.forEach(word1 => {
    words2.forEach(word2 => {
      if (word1.includes(word2) || word2.includes(word1)) {
        matches++;
      }
    });
  });

  return matches / Math.max(words1.length, words2.length);
}

/**
 * Validate that the column mapping covers all required fields
 */
export function validateColumnMapping(mapping: ColumnMapping, headers: string[]): {
  isValid: boolean;
  missingRequired: string[];
  invalidColumns: Array<{ field: string; column: string }>;
  suggestions: Array<{ field: string; suggestedColumn: string }>;
} {
  const requiredFields = ['description', 'quantity', 'uom'];
  const missingRequired: string[] = [];
  const invalidColumns: Array<{ field: string; column: string }> = [];
  const suggestions: Array<{ field: string; suggestedColumn: string }> = [];

  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

  // Check required fields
  requiredFields.forEach(field => {
    const mappedColumns = mapping[field as keyof ColumnMapping];
    if (!mappedColumns || mappedColumns.length === 0) {
      missingRequired.push(field);
    } else {
      // Check if mapped columns exist in headers
      const validColumn = mappedColumns.find(col => 
        normalizedHeaders.includes(col.toLowerCase().trim())
      );
      if (!validColumn) {
        invalidColumns.push({ field, column: mappedColumns[0]! });
        missingRequired.push(field);
      }
    }
  });

  // Generate suggestions for missing fields
  missingRequired.forEach(field => {
    const possibleColumns = DEFAULT_COLUMN_MAPPING[field as keyof ColumnMapping];
    const suggestion = possibleColumns.find(possible => 
      normalizedHeaders.some(header => 
        header.includes(possible.toLowerCase()) || possible.toLowerCase().includes(header)
      )
    );
    
    if (suggestion) {
      const actualHeader = headers.find(h => 
        h.toLowerCase().trim().includes(suggestion.toLowerCase()) ||
        suggestion.toLowerCase().includes(h.toLowerCase().trim())
      );
      if (actualHeader) {
        suggestions.push({ field, suggestedColumn: actualHeader });
      }
    }
  });

  return {
    isValid: missingRequired.length === 0,
    missingRequired,
    invalidColumns,
    suggestions
  };
}

/**
 * Create a custom column mapping from user selections
 */
export function createCustomMapping(fieldMappings: Record<string, string>): ColumnMapping {
  const customMapping: ColumnMapping = { ...DEFAULT_COLUMN_MAPPING };

  Object.entries(fieldMappings).forEach(([field, selectedColumn]) => {
    if (selectedColumn && customMapping[field as keyof ColumnMapping]) {
      customMapping[field as keyof ColumnMapping] = [selectedColumn];
    }
  });

  return customMapping;
}

/**
 * Get available unmapped columns for manual mapping
 */
export function getAvailableColumns(
  headers: string[], 
  currentMapping: Partial<ColumnMapping>
): string[] {
  const mappedColumns = new Set<string>();
  
  Object.values(currentMapping).forEach(columns => {
    if (columns) {
      columns.forEach(col => mappedColumns.add(col.toLowerCase().trim()));
    }
  });

  return headers.filter(header => 
    !mappedColumns.has(header.toLowerCase().trim())
  );
}