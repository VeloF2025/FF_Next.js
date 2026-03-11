/**
 * File Validator
 * Validates files before processing and provides detailed error reporting
 */

import type { FileProcessingOptions, ProcessingError, ValidationResult } from '../types';

export class FileValidator {
  private readonly MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB default
  private readonly SUPPORTED_TYPES = ['csv', 'xlsx', 'xls'];
  private readonly SUPPORTED_MIME_TYPES = [
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  /**
   * Validate file before processing
   */
  public async validateFile(
    file: File,
    options: Partial<FileProcessingOptions>
  ): Promise<ValidationResult & { errors: string[] }> {
    const errors: string[] = [];
    const suggestions: string[] = [];

    // File existence check
    if (!file) {
      errors.push('No file provided');
      return { isValid: false, errors, message: 'File is required' };
    }

    // File size validation
    const maxSize = options.maxFileSize || this.MAX_FILE_SIZE;
    if (file.size > maxSize) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2);
      errors.push(`File size ${sizeMB}MB exceeds maximum allowed size of ${maxSizeMB}MB`);
      suggestions.push('Try splitting the file into smaller chunks or use streaming mode');
    }

    // Empty file check
    if (file.size === 0) {
      errors.push('File is empty');
      return { isValid: false, errors, message: 'File cannot be empty' };
    }

    // File type validation
    const typeValidation = this.validateFileType(file);
    if (!typeValidation.isValid) {
      errors.push(typeValidation.message || 'Invalid file type');
      suggestions.push('Supported formats: CSV, XLSX, XLS');
    }

    // File name validation
    const nameValidation = this.validateFileName(file.name);
    if (!nameValidation.isValid) {
      errors.push(nameValidation.message || 'Invalid file name');
    }

    // Advanced validation based on file content
    try {
      const contentValidation = await this.validateFileContent(file);
      if (!contentValidation.isValid) {
        errors.push(contentValidation.message || 'Invalid file content');
      }
    } catch (error) {
      errors.push(`Content validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Memory estimation
    const memoryEstimate = this.estimateMemoryUsage(file);
    const availableMemory = this.getAvailableMemory();
    
    if (memoryEstimate > availableMemory * 0.8) {
      errors.push('File may exceed available memory during processing');
      suggestions.push('Consider using streaming mode for large files');
    }

    const isValid = errors.length === 0;
    const message = isValid ? 'File validation passed' : errors.join('; ');
    const suggestion = suggestions.length > 0 ? suggestions.join('; ') : undefined;

    return {
      isValid,
      message,
      errors,
      ...(suggestion && { suggestion })
    };
  }

  /**
   * Validate file type and extension
   */
  private validateFileType(file: File): ValidationResult {
    const extension = this.getFileExtension(file.name).toLowerCase();
    const mimeType = file.type.toLowerCase();

    // Check extension
    if (!this.SUPPORTED_TYPES.includes(extension)) {
      return {
        isValid: false,
        message: `Unsupported file extension: .${extension}`,
        suggestion: `Supported extensions: ${this.SUPPORTED_TYPES.map(t => `.${t}`).join(', ')}`
      };
    }

    // Check MIME type if available
    if (file.type && !this.SUPPORTED_MIME_TYPES.some(type => mimeType.includes(type))) {
      return {
        isValid: false,
        message: `Unsupported MIME type: ${file.type}`,
        suggestion: 'File may be corrupted or have incorrect extension'
      };
    }

    // Extension-MIME type consistency check
    const consistencyCheck = this.validateTypeConsistency(extension, mimeType);
    if (!consistencyCheck.isValid) {
      return consistencyCheck;
    }

    return { isValid: true };
  }

  /**
   * Validate file name
   */
  private validateFileName(fileName: string): ValidationResult {
    // Check for valid characters
    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidChars.test(fileName)) {
      return {
        isValid: false,
        message: 'File name contains invalid characters',
        suggestion: 'Remove special characters from file name'
      };
    }

    // Check length
    if (fileName.length > 255) {
      return {
        isValid: false,
        message: 'File name is too long (maximum 255 characters)',
        suggestion: 'Shorten the file name'
      };
    }

    // Check for reserved names (Windows)
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    const baseName = fileName.split('.')[0]!.toUpperCase();
    if (reservedNames.includes(baseName)) {
      return {
        isValid: false,
        message: `File name "${baseName}" is reserved`,
        suggestion: 'Use a different file name'
      };
    }

    return { isValid: true };
  }

  /**
   * Validate file content by reading first few bytes
   */
  private async validateFileContent(file: File): Promise<ValidationResult> {
    return new Promise((resolve) => {
      const extension = this.getFileExtension(file.name).toLowerCase();
      
      // Read first 512 bytes for file signature validation
      const reader = new FileReader();
      const slice = file.slice(0, 512);
      
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          if (!arrayBuffer) {
            resolve({ isValid: false, message: 'Unable to read file content' });
            return;
          }

          const bytes = new Uint8Array(arrayBuffer);
          const validation = this.validateFileSignature(bytes, extension);
          resolve(validation);
        } catch (error) {
          resolve({
            isValid: false,
            message: `Content validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      };

      reader.onerror = () => {
        resolve({ isValid: false, message: 'Unable to read file' });
      };

      reader.readAsArrayBuffer(slice);
    });
  }

  /**
   * Validate file signature (magic bytes)
   */
  private validateFileSignature(bytes: Uint8Array, extension: string): ValidationResult {
    // Excel file signatures
    if (extension === 'xlsx') {
      // XLSX files start with PK (ZIP signature)
      if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
        return { isValid: true };
      }
      return {
        isValid: false,
        message: 'File does not appear to be a valid XLSX file',
        suggestion: 'File may be corrupted or have wrong extension'
      };
    }

    if (extension === 'xls') {
      // XLS files have various signatures
      const xlsSignatures = [
        [0xD0, 0xCF, 0x11, 0xE0], // MS Office signature
        [0x09, 0x08, 0x06, 0x00], // Old Excel format
        [0xFD, 0xFF, 0xFF, 0xFF]  // Another Excel format
      ];

      const hasValidSignature = xlsSignatures.some(signature =>
        signature.every((byte, index) => bytes[index] === byte)
      );

      if (!hasValidSignature) {
        return {
          isValid: false,
          message: 'File does not appear to be a valid XLS file',
          suggestion: 'File may be corrupted or have wrong extension'
        };
      }
      return { isValid: true };
    }

    if (extension === 'csv') {
      // CSV files should be text-based
      // Check for common text characters in first 100 bytes
      const text = Array.from(bytes.slice(0, 100))
        .map(byte => String.fromCharCode(byte))
        .join('');

      // Check for printable ASCII characters
      const printableRegex = /^[\x20-\x7E\r\n\t]*$/;
      if (!printableRegex.test(text)) {
        return {
          isValid: false,
          message: 'File does not appear to be a valid CSV file',
          suggestion: 'File may be binary or have wrong extension'
        };
      }
      return { isValid: true };
    }

    return { isValid: true }; // Unknown extension, assume valid
  }

  /**
   * Validate consistency between extension and MIME type
   */
  private validateTypeConsistency(extension: string, mimeType: string): ValidationResult {
    const typeMap: Record<string, string[]> = {
      csv: ['text/csv', 'application/csv', 'text/plain'],
      xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      xls: ['application/vnd.ms-excel', 'application/excel']
    };

    const expectedTypes = typeMap[extension];
    if (expectedTypes && mimeType && !expectedTypes.some(type => mimeType.includes(type))) {
      return {
        isValid: false,
        message: `File extension .${extension} doesn't match MIME type ${mimeType}`,
        suggestion: 'File may have incorrect extension or be corrupted'
      };
    }

    return { isValid: true };
  }

  /**
   * Estimate memory usage for file processing
   */
  private estimateMemoryUsage(file: File): number {
    const extension = this.getFileExtension(file.name).toLowerCase();
    
    // Memory usage multipliers based on file type
    const multipliers: Record<string, number> = {
      csv: 3,    // CSV files typically expand 3x in memory
      xlsx: 5,   // Excel files can expand 5x due to formatting
      xls: 4     // Legacy Excel format
    };

    const multiplier = multipliers[extension] || 3;
    return file.size * multiplier;
  }

  /**
   * Get available memory (rough estimate)
   */
  private getAvailableMemory(): number {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in performance) {
      const memory = (performance as any).memory;
      return memory.totalJSHeapSize - memory.usedJSHeapSize;
    }
    
    // Fallback estimate: assume 1GB available
    return 1024 * 1024 * 1024;
  }

  /**
   * Get file extension from filename
   */
  private getFileExtension(fileName: string): string {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts.pop() || '' : '';
  }

  /**
   * Validate specific field rules
   */
  public validateFieldRules(
    data: Record<string, unknown>,
    rules: Array<{
      field: string;
      required?: boolean;
      type?: 'string' | 'number' | 'date' | 'email';
      pattern?: RegExp;
      min?: number;
      max?: number;
    }>
  ): { isValid: boolean; errors: ProcessingError[] } {
    const errors: ProcessingError[] = [];

    for (const rule of rules) {
      const value = data[rule.field];

      // Required field check
      if (rule.required && (value === null || value === undefined || value === '')) {
        errors.push({
          type: 'validation',
          severity: 'high',
          message: `Required field '${rule.field}' is missing`,
          column: rule.field,
          timestamp: new Date(),
          recoverable: false
        });
        continue;
      }

      // Skip further validation for null/undefined/empty values if not required
      if (value === null || value === undefined || value === '') {
        continue;
      }

      // Type validation
      if (rule.type) {
        const typeValid = this.validateFieldType(value, rule.type);
        if (!typeValid) {
          errors.push({
            type: 'validation',
            severity: 'medium',
            message: `Field '${rule.field}' must be of type ${rule.type}`,
            column: rule.field,
            timestamp: new Date(),
            recoverable: true
          });
        }
      }

      // Pattern validation
      if (rule.pattern && typeof value === 'string') {
        if (!rule.pattern.test(value)) {
          errors.push({
            type: 'validation',
            severity: 'medium',
            message: `Field '${rule.field}' does not match required pattern`,
            column: rule.field,
            timestamp: new Date(),
            recoverable: true
          });
        }
      }

      // Range validation for numbers
      if (typeof value === 'number') {
        if (rule.min !== undefined && value < rule.min) {
          errors.push({
            type: 'validation',
            severity: 'medium',
            message: `Field '${rule.field}' must be at least ${rule.min}`,
            column: rule.field,
            timestamp: new Date(),
            recoverable: true
          });
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push({
            type: 'validation',
            severity: 'medium',
            message: `Field '${rule.field}' must not exceed ${rule.max}`,
            column: rule.field,
            timestamp: new Date(),
            recoverable: true
          });
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate field type
   */
  private validateFieldType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'date':
        return value instanceof Date || !isNaN(Date.parse(String(value)));
      case 'email':
        return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      default:
        return true;
    }
  }
}