/**
 * Enhanced High-Performance Excel Processor
 * Uses ExcelJS and XLSX for optimal Excel file processing
 */

import * as XLSX from 'xlsx';
import * as ExcelJS from 'exceljs';
import type {
  FileProcessingOptions,
  FileProcessingResult,
  ProcessingContext,
  ExcelProcessingOptions,
  ExcelMetadata,
  ExcelSheetInfo,
  ProcessingError,
  ProcessingWarning,
  MemoryStats
} from '../types';

export class EnhancedExcelProcessor {
  private readonly MAX_DIRECT_SIZE = 10 * 1024 * 1024; // 10MB for Excel files
  private readonly CHUNK_SIZE = 1000; // Rows per chunk

  /**
   * Process Excel file with automatic strategy selection
   */
  public async process<T = unknown>(
    file: File,
    options: FileProcessingOptions,
    context: ProcessingContext
  ): Promise<FileProcessingResult<T>> {
    const excelOptions = options as ExcelProcessingOptions;
    
    // Update context
    context.status = 'parsing';
    
    if (file.size > this.MAX_DIRECT_SIZE || options.streaming) {
      return this.processWithExcelJS<T>(file, excelOptions, context);
    } else {
      return this.processWithXLSX<T>(file, excelOptions, context);
    }
  }

  /**
   * Fast processing with XLSX for smaller files
   */
  private async processWithXLSX<T>(
    file: File,
    options: ExcelProcessingOptions,
    context: ProcessingContext
  ): Promise<FileProcessingResult<T>> {
    const startTime = performance.now();
    const errors: ProcessingError[] = [];
    const warnings: ProcessingWarning[] = [];

    try {
      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();
      
      // Parse with XLSX
      const workbook = XLSX.read(arrayBuffer, {
        type: 'array',
        ...(options.dateFormat && { dateNF: options.dateFormat }),
        cellDates: true,
        cellNF: false,
        cellText: false
      });

      // Get sheet information
      const sheetsInfo = this.getSheetInfo(workbook);
      
      // Determine target sheet
      const targetSheet = this.getTargetSheet(workbook, options);
      if (!targetSheet) {
        throw new Error('No valid sheet found in Excel file');
      }

      // Convert sheet to JSON (raw array format for header processing)
      const sheetData = XLSX.utils.sheet_to_json(targetSheet, {
        header: 1,
        defval: null,
        blankrows: !options.skipEmptyLines,
        raw: !options.evaluateFormulas
      }) as unknown[][];

      // Process headers and data
      const { headers, data } = this.processSheetData<T>(sheetData, options);

      // Progress callback
      if (options.progressCallback) {
        options.progressCallback({
          processedRows: data.length,
          totalRows: data.length,
          percentage: 100,
          estimatedTimeRemaining: 0,
          currentPhase: 'validating',
          bytesProcessed: file.size,
          totalBytes: file.size,
          memoryUsage: this.getMemoryStats()
        });
      }

      // Validation
      context.status = 'validating';
      const validationResults = this.validateData(data, options);
      errors.push(...validationResults.errors);
      warnings.push(...validationResults.warnings);

      const endTime = performance.now();

      // Create Excel-specific metadata
      const metadata: ExcelMetadata = {
        ...context.metadata,
        rowCount: data.length,
        columnCount: headers.length,
        headers,
        sheets: sheetsInfo,
        activeSheet: workbook.SheetNames[0] ?? '',
        formulas: this.countFormulas(targetSheet),
        images: 0, // XLSX doesn't provide image count
        charts: 0, // XLSX doesn't provide chart count
        processingEndTime: new Date()
      };

      const result: FileProcessingResult<T> = {
        data,
        metadata,
        errors,
        warnings,
        processingTime: endTime - startTime,
        memoryUsage: this.getMemoryStats(),
        rowsProcessed: data.length,
        rowsSkipped: 0,
        isPartial: false,
        strategy: 'direct'
      };

      context.status = 'complete';
      return result;

    } catch (error) {
      const processingError: ProcessingError = {
        type: 'parsing',
        severity: 'critical',
        message: `Excel parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
        recoverable: false
      };
      
      throw new Error(`Excel processing failed: ${processingError.message}`);
    }
  }

  /**
   * Advanced processing with ExcelJS for large files and complex features
   */
  private async processWithExcelJS<T>(
    file: File,
    options: ExcelProcessingOptions,
    context: ProcessingContext
  ): Promise<FileProcessingResult<T>> {
    const startTime = performance.now();
    const errors: ProcessingError[] = [];
    const warnings: ProcessingWarning[] = [];
    const data: T[] = [];

    try {
      // Create workbook and load file
      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await file.arrayBuffer();
      
      await workbook.xlsx.load(arrayBuffer);

      // Get sheet information
      const sheetsInfo = this.getExcelJSSheetInfo(workbook);
      
      // Determine target worksheet
      const targetWorksheet = this.getTargetWorksheet(workbook, options);
      if (!targetWorksheet) {
        throw new Error('No valid worksheet found in Excel file');
      }

      // Get headers
      const headers = this.extractHeaders(targetWorksheet);
      let processedRows = 0;
      const totalRows = targetWorksheet.actualRowCount;

      // Process rows in chunks
      const chunks = Math.ceil(totalRows / this.CHUNK_SIZE);
      
      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const startRow = (chunkIndex * this.CHUNK_SIZE) + 2; // Skip header row
        const endRow = Math.min(startRow + this.CHUNK_SIZE - 1, totalRows);

        const chunkData: T[] = [];

        // Process chunk
        for (let rowNum = startRow; rowNum <= endRow; rowNum++) {
          const row = targetWorksheet.getRow(rowNum);
          
          if (this.shouldSkipRow(row, options)) {
            continue;
          }

          const rowData = this.convertRowToObject<T>(row, headers, options);
          if (rowData) {
            chunkData.push(rowData);
          }
          
          processedRows++;
        }

        // Add chunk to main data
        data.push(...chunkData);

        // Progress callback
        if (options.progressCallback) {
          const progress = {
            processedRows,
            totalRows,
            percentage: (processedRows / totalRows) * 100,
            estimatedTimeRemaining: this.estimateTimeRemaining(
              startTime,
              processedRows,
              totalRows
            ),
            currentPhase: 'parsing' as const,
            bytesProcessed: (file.size * processedRows) / totalRows,
            totalBytes: file.size,
            memoryUsage: this.getMemoryStats()
          };
          
          options.progressCallback(progress);
        }

        // Memory management
        if (this.shouldTriggerGC(chunkIndex)) {
          this.triggerGarbageCollection();
        }

        // Check cancellation
        if (context.cancellationToken?.signal.aborted) {
          throw new Error('Processing cancelled');
        }
      }

      // Validation
      context.status = 'validating';
      const validationResults = this.validateData(data, options);
      errors.push(...validationResults.errors);
      warnings.push(...validationResults.warnings);

      const endTime = performance.now();

      // Create enhanced metadata
      const metadata: ExcelMetadata = {
        ...context.metadata,
        rowCount: data.length,
        columnCount: headers.length,
        headers,
        sheets: sheetsInfo,
        activeSheet: targetWorksheet.name,
        formulas: this.countExcelJSFormulas(targetWorksheet),
        images: targetWorksheet.getImages().length,
        charts: this.countCharts(targetWorksheet),
        processingEndTime: new Date()
      };

      const result: FileProcessingResult<T> = {
        data,
        metadata,
        errors,
        warnings,
        processingTime: endTime - startTime,
        memoryUsage: this.getMemoryStats(),
        rowsProcessed: data.length,
        rowsSkipped: processedRows - data.length,
        isPartial: false,
        strategy: 'streaming'
      };

      context.status = 'complete';
      return result;

    } catch (error) {
      const processingError: ProcessingError = {
        type: 'parsing',
        severity: 'critical',
        message: `ExcelJS parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
        recoverable: false
      };
      
      throw new Error(`Excel processing failed: ${processingError.message}`);
    }
  }

  // XLSX Helper Methods
  private getSheetInfo(workbook: XLSX.WorkBook): ExcelSheetInfo[] {
    return workbook.SheetNames.map((name, index) => {
      const sheet = workbook.Sheets[name];
      const range = XLSX.utils.decode_range(sheet?.['!ref'] || 'A1:A1');

      return {
        name,
        index,
        rowCount: range.e.r + 1,
        columnCount: range.e.c + 1,
        hasData: !!sheet?.['!ref'],
        ...(sheet?.['!ref'] && { range: sheet['!ref'] })
      };
    });
  }

  private getTargetSheet(workbook: XLSX.WorkBook, options: ExcelProcessingOptions): XLSX.WorkSheet | null {
    if (options.sheetName) {
      return workbook.Sheets[options.sheetName] ?? null;
    }
    
    if (options.sheetIndex !== undefined) {
      const sheetName = workbook.SheetNames[options.sheetIndex];
      return sheetName ? (workbook.Sheets[sheetName] ?? null) : null;
    }

    // Default to first sheet
    const firstSheetName = workbook.SheetNames[0];
    return firstSheetName ? (workbook.Sheets[firstSheetName] ?? null) : null;
  }

  private processSheetData<T>(sheetData: unknown[][], options: ExcelProcessingOptions): {
    headers: string[];
    data: T[];
  } {
    if (sheetData.length === 0) {
      return { headers: [], data: [] };
    }

    // Extract headers
    const headers = (sheetData[0] as string[]).map(h => 
      options.trimWhitespace ? String(h || '').trim() : String(h || '')
    );

    // Process data rows
    const data = sheetData.slice(1).map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      
      headers.forEach((header, index) => {
        let value = row[index];
        
        // Handle empty values
        if (value === null || value === undefined || value === '') {
          value = null;
        }
        
        obj[header] = value;
      });
      
      return obj as T;
    }).filter(row => {
      // Skip empty rows if requested
      if (options.skipEmptyLines) {
        return Object.values(row as Record<string, unknown>).some(v => v !== null && v !== '');
      }
      return true;
    });

    return { headers, data };
  }

  private countFormulas(sheet: XLSX.WorkSheet): number {
    let formulaCount = 0;
    
    Object.keys(sheet).forEach(cellRef => {
      if (cellRef.startsWith('!')) return;
      
      const cell = sheet[cellRef];
      if (cell && cell.f) {
        formulaCount++;
      }
    });
    
    return formulaCount;
  }

  // ExcelJS Helper Methods
  private getExcelJSSheetInfo(workbook: ExcelJS.Workbook): ExcelSheetInfo[] {
    return workbook.worksheets.map((worksheet, index) => ({
      name: worksheet.name,
      index,
      rowCount: worksheet.actualRowCount,
      columnCount: worksheet.actualColumnCount,
      hasData: worksheet.actualRowCount > 0,
      range: `A1:${this.getColumnLetter(worksheet.actualColumnCount)}${worksheet.actualRowCount}`
    }));
  }

  private getTargetWorksheet(workbook: ExcelJS.Workbook, options: ExcelProcessingOptions): ExcelJS.Worksheet | null {
    if (options.sheetName) {
      return workbook.getWorksheet(options.sheetName) || null;
    }
    
    if (options.sheetIndex !== undefined) {
      return workbook.getWorksheet(options.sheetIndex + 1) || null; // ExcelJS uses 1-based indexing
    }
    
    // Default to first worksheet
    return workbook.getWorksheet(1) || null;
  }

  private extractHeaders(worksheet: ExcelJS.Worksheet): string[] {
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value || '');
    });
    
    return headers;
  }

  private shouldSkipRow(row: ExcelJS.Row, options: ExcelProcessingOptions): boolean {
    if (!options.skipEmptyLines) return false;
    
    let hasValue = false;
    row.eachCell((cell) => {
      if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
        hasValue = true;
      }
    });
    
    return !hasValue;
  }

  private convertRowToObject<T>(
    row: ExcelJS.Row,
    headers: string[],
    options: ExcelProcessingOptions
  ): T | null {
    const obj: Record<string, unknown> = {};
    
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (!header) return;
      
      let value = cell.value;
      
      // Handle formulas
      if (options.evaluateFormulas && cell.formula) {
        value = cell.result || cell.value;
      }
      
      // Handle dates
      if (cell.type === ExcelJS.ValueType.Date && value instanceof Date) {
        value = value.toISOString();
      }
      
      // Trim whitespace if requested
      if (options.trimWhitespace && typeof value === 'string') {
        value = value.trim();
      }
      
      obj[header] = value;
    });
    
    return obj as T;
  }

  private countExcelJSFormulas(worksheet: ExcelJS.Worksheet): number {
    let formulaCount = 0;
    
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.formula) {
          formulaCount++;
        }
      });
    });
    
    return formulaCount;
  }

  private countCharts(_worksheet: ExcelJS.Worksheet): number {
    // ExcelJS doesn't provide direct chart access
    // This would require more complex implementation
    return 0;
  }

  private getColumnLetter(columnNumber: number): string {
    let letter = '';
    while (columnNumber > 0) {
      const remainder = (columnNumber - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      columnNumber = Math.floor((columnNumber - 1) / 26);
    }
    return letter;
  }

  // Common validation and utility methods
  private validateData<T>(
    data: T[],
    options: ExcelProcessingOptions
  ): { errors: ProcessingError[]; warnings: ProcessingWarning[] } {
    const errors: ProcessingError[] = [];
    const warnings: ProcessingWarning[] = [];

    if (!options.validationRules || options.validationRules.length === 0) {
      return { errors, warnings };
    }

    for (let i = 0; i < data.length; i++) {
      const row = data[i] as Record<string, unknown>;
      
      for (const rule of options.validationRules) {
        const result = rule.validator(row[rule.field], row);
        
        if (!result.isValid) {
          const error: ProcessingError = {
            type: 'validation',
            severity: rule.severity === 'error' ? 'high' : 'medium',
            message: result.message || rule.message || `Validation failed for field: ${rule.field}`,
            row: i + 2, // +2 because Excel rows are 1-indexed and we skip header
            column: rule.field,
            timestamp: new Date(),
            recoverable: rule.severity !== 'error',
            ...(result.suggestion && { details: result.suggestion })
          };

          if (rule.severity === 'error') {
            errors.push(error);
          } else {
            warnings.push({
              type: 'data',
              message: error.message,
              timestamp: error.timestamp,
              ...(error.details && { suggestion: error.details }),
              ...(error.row && { row: error.row }),
              ...(error.column && { column: error.column })
            });
          }
        }
      }
    }

    return { errors, warnings };
  }

  private getMemoryStats(): MemoryStats {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in performance) {
      const memory = (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
      return {
        heapUsed: memory.usedJSHeapSize,
        heapTotal: memory.totalJSHeapSize,
        external: 0,
        peakUsage: memory.totalJSHeapSize
      };
    }

    return {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      peakUsage: 0
    };
  }

  private estimateTimeRemaining(
    startTime: number,
    processedRows: number,
    totalRows: number
  ): number {
    if (processedRows === 0) return 0;
    
    const elapsedTime = performance.now() - startTime;
    const processingRate = processedRows / elapsedTime; // rows per ms
    const remainingRows = totalRows - processedRows;
    
    return remainingRows / processingRate;
  }

  private shouldTriggerGC(chunkIndex: number): boolean {
    return chunkIndex % 10 === 0 || this.isMemoryHigh();
  }

  private isMemoryHigh(): boolean {
    const stats = this.getMemoryStats();
    return stats.heapUsed > 0 && (stats.heapUsed / stats.heapTotal) > 0.8;
  }

  private triggerGarbageCollection(): void {
    if (typeof window !== 'undefined' && (window as unknown as { gc?: () => void }).gc) {
      (window as unknown as { gc: () => void }).gc();
    }
  }
}