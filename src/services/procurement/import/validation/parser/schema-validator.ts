/**
 * Schema Validator Module
 * Validates data against predefined schemas and rules
 */

import { 
  DataSchema, 
  SchemaField, 
  ImportError, 
  ImportWarning, 
  ValidationContext,
  ParseResult 
} from './parser-types';
import { readValue } from './data-reader';
import { detectDataType } from './format-detector';

/**
 * Validate data against schema
 */
export function validateAgainstSchema(
  data: Record<string, unknown>[],
  schema: DataSchema
): {
  validData: Record<string, unknown>[];
  errors: ImportError[];
  warnings: ImportWarning[];
  fieldMapping: Record<string, string>;
} {
  const validData: Record<string, unknown>[] = [];
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const fieldMapping: Record<string, string> = {};

  if (!data || data.length === 0) {
    errors.push({
      type: 'validation',
      row: 0,
      column: 'data',
      message: 'No data provided for validation'
    });
    return { validData, errors, warnings, fieldMapping };
  }

  // Validate headers and create field mapping
  const headers = Object.keys(data[0] || {});
  const mappingResult = createFieldMapping(headers, schema, errors, warnings);
  Object.assign(fieldMapping, mappingResult);

  // Validate each row
  data.forEach((row, index) => {
    const rowErrors: ImportError[] = [];
    const rowWarnings: ImportWarning[] = [];
    const validatedRow: Record<string, unknown> = {};

    schema.fields.forEach(field => {
      const context: ValidationContext = {
        row: index + 1,
        field: field.name,
        schema: field,
        strict: schema.strict
      };

      const mappedFieldName = fieldMapping[field.name] || field.name;
      const rawValue = row[mappedFieldName];

      const result = validateField(rawValue, field, context, rowErrors, rowWarnings);
      
      if (result.success || !schema.strict) {
        validatedRow[field.name] = result.value;
      }
    });

    // Check for extra fields if not allowed
    if (!schema.allowExtraFields) {
      Object.keys(row).forEach(key => {
        if (!Object.values(fieldMapping).includes(key)) {
          rowWarnings.push({
            type: 'validation',
            row: index + 1,
            column: key,
            message: `Extra field "${key}" not defined in schema`
          });
        }
      });
    }

    errors.push(...rowErrors);
    warnings.push(...rowWarnings);
    
    if (rowErrors.length === 0 || !schema.strict) {
      validData.push(validatedRow);
    }
  });

  return { validData, errors, warnings, fieldMapping };
}

/**
 * Validate a single field against its schema
 */
export function validateField(
  value: unknown,
  field: SchemaField,
  context: ValidationContext,
  errors: ImportError[],
  warnings: ImportWarning[]
): ParseResult {
  const { format } = field;
  
  // Handle required validation
  if (format.required && (value === null || value === undefined || value === '')) {
    errors.push({
      type: 'validation',
      row: context.row,
      column: context.field,
      message: `${context.field} is required`
    });
    return { success: false, value: undefined, errors, warnings, originalValue: value };
  }

  // Handle empty values for non-required fields
  if (!format.required && (value === null || value === undefined || value === '')) {
    return { 
      success: true, 
      value: field.defaultValue, 
      errors, 
      warnings, 
      originalValue: value 
    };
  }

  // Apply transformer if provided
  let processedValue = value;
  if (field.transformer) {
    try {
      processedValue = field.transformer(value);
    } catch (error) {
      errors.push({
        type: 'parsing',
        row: context.row,
        column: context.field,
        message: `Transformation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      return { success: false, value: undefined, errors, warnings, originalValue: value };
    }
  }

  // Parse value according to type
  const parsedValue = readValue(processedValue, format.type, context, errors, warnings);

  // Apply constraints
  if (parsedValue !== undefined) {
    validateConstraints(parsedValue, field, context, errors, warnings);
  }

  return {
    success: errors.length === 0,
    value: parsedValue,
    errors,
    warnings,
    originalValue: value
  };
}

/**
 * Validate field constraints
 */
function validateConstraints(
  value: unknown,
  field: SchemaField,
  context: ValidationContext,
  errors: ImportError[],
  _warnings: ImportWarning[]
): void {
  const { constraints } = field.format;
  
  if (!constraints) return;

  // Numeric constraints
  if (typeof value === 'number') {
    if (constraints.min !== undefined && value < constraints.min) {
      errors.push({
        type: 'validation',
        row: context.row,
        column: context.field,
        message: `${context.field} must be at least ${constraints.min}`
      });
    }
    
    if (constraints.max !== undefined && value > constraints.max) {
      errors.push({
        type: 'validation',
        row: context.row,
        column: context.field,
        message: `${context.field} cannot exceed ${constraints.max}`
      });
    }
  }

  // String length constraints
  if (typeof value === 'string') {
    if (constraints.minLength !== undefined && value.length < constraints.minLength) {
      errors.push({
        type: 'validation',
        row: context.row,
        column: context.field,
        message: `${context.field} must be at least ${constraints.minLength} characters`
      });
    }
    
    if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
      errors.push({
        type: 'validation',
        row: context.row,
        column: context.field,
        message: `${context.field} cannot exceed ${constraints.maxLength} characters`
      });
    }
  }

  // Pattern validation
  if (field.format.pattern && typeof value === 'string') {
    if (!field.format.pattern.test(value)) {
      errors.push({
        type: 'validation',
        row: context.row,
        column: context.field,
        message: `${context.field} does not match required pattern`
      });
    }
  }
}

/**
 * Create field mapping between data headers and schema fields
 */
function createFieldMapping(
  headers: string[],
  schema: DataSchema,
  errors: ImportError[],
  warnings: ImportWarning[]
): Record<string, string> {
  const mapping: Record<string, string> = {};
  
  schema.fields.forEach(field => {
    let mappedHeader = headers.find(header => 
      header.toLowerCase().trim() === field.name.toLowerCase().trim()
    );

    // Try aliases if direct match not found
    if (!mappedHeader && field.aliases) {
      mappedHeader = headers.find(header => 
        field.aliases!.some(alias => 
          header.toLowerCase().trim() === alias.toLowerCase().trim()
        )
      );
    }

    if (mappedHeader) {
      mapping[field.name] = mappedHeader;
    } else {
      if (field.format.required) {
        errors.push({
          type: 'validation',
          row: 0,
          column: field.name,
          message: `Required field "${field.name}" not found in data headers`
        });
      } else {
        warnings.push({
          type: 'validation',
          row: 0,
          column: field.name,
          message: `Optional field "${field.name}" not found in data headers, will use default value`
        });
      }
    }
  });

  return mapping;
}

/**
 * Auto-generate schema from data sample
 */
export function generateSchemaFromData(
  data: Record<string, unknown>[],
  options: {
    sampleSize?: number;
    strictMode?: boolean;
    inferRequired?: boolean;
  } = {}
): DataSchema {
  const {
    sampleSize = Math.min(100, data.length),
    strictMode = false,
    inferRequired = true
  } = options;

  if (!data || data.length === 0) {
    return { fields: [], strict: strictMode };
  }

  const sampleData = data.slice(0, sampleSize);
  const headers = Object.keys(sampleData[0] || {});
  const fields: SchemaField[] = [];

  headers.forEach(header => {
    const samples = sampleData.map(row => row[header]).filter(v => v !== null && v !== undefined);
    const nonEmptySamples = samples.filter(v => v !== '');
    
    const typeResult = detectDataType(samples);
    const requiredPercent = nonEmptySamples.length / sampleData.length;
    
    // Map 'unknown' type to 'string' as fallback
    const fieldType = typeResult.type === 'unknown' ? 'string' : typeResult.type;
    
    const field: SchemaField = {
      name: header,
      format: {
        type: fieldType as Exclude<typeof typeResult.type, 'unknown'>,
        required: inferRequired && requiredPercent > 0.8
      }
    };

    // Add constraints based on data analysis
    if (typeResult.type === 'string' && nonEmptySamples.length > 0) {
      const maxLength = Math.max(...nonEmptySamples.map(s => String(s).length));
      field.format.constraints = { maxLength: Math.ceil(maxLength * 1.2) };
    }

    if (typeResult.type === 'number' && nonEmptySamples.length > 0) {
      const numericSamples = nonEmptySamples.filter(s => !isNaN(Number(s))).map(Number);
      if (numericSamples.length > 0) {
        field.format.constraints = {
          min: Math.min(...numericSamples),
          max: Math.max(...numericSamples)
        };
      }
    }

    fields.push(field);
  });

  return {
    fields,
    strict: strictMode,
    allowExtraFields: !strictMode
  };
}

/**
 * Validate schema definition itself
 */
export function validateSchema(schema: DataSchema): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!schema.fields || schema.fields.length === 0) {
    errors.push('Schema must define at least one field');
  }

  const fieldNames = new Set<string>();
  
  schema.fields.forEach((field, index) => {
    if (!field.name || field.name.trim() === '') {
      errors.push(`Field at index ${index} must have a name`);
    }

    if (fieldNames.has(field.name)) {
      errors.push(`Duplicate field name: "${field.name}"`);
    }
    fieldNames.add(field.name);

    if (!field.format) {
      errors.push(`Field "${field.name}" must have a format definition`);
    } else {
      const validTypes = ['string', 'number', 'date', 'boolean', 'email', 'phone'];
      if (!validTypes.includes(field.format.type)) {
        errors.push(`Field "${field.name}" has invalid type: "${field.format.type}"`);
      }
    }

    // Validate aliases
    if (field.aliases) {
      field.aliases.forEach(alias => {
        if (fieldNames.has(alias)) {
          warnings.push(`Alias "${alias}" for field "${field.name}" conflicts with another field name`);
        }
      });
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}