/**
 * Excel Parser - Column Mapping
 * Handles header detection and field mapping
 */

import { ColumnMapping, ParsedBOQItem, ParseConfig, RawBOQRow } from './types';
import { isHeaderRow } from '../validation';

export class ColumnMapper {
  private config: ParseConfig;

  constructor(config: ParseConfig) {
    this.config = config;
  }

  /**
   * Detect header row from raw data
   */
  detectHeaders(rawData: string[][]): string[] {
    const startRow = this.config.headerRow || 0;
    
    // Try to detect headers
    for (let i = startRow; i < Math.min(startRow + 10, rawData.length); i++) {
      const row = rawData[i]!;
      const rowObj = this.arrayToObject(row, this.getDefaultColumnMapping());
      
      if (isHeaderRow(rowObj)) {
        this.config.headerRow = i;
        return row.map(cell => String(cell || '').trim());
      }
    }
    
    // If no headers detected, use default
    return rawData[startRow] || [];
  }

  /**
   * Map column headers to BOQ fields
   */
  mapColumns(headers: string[]): ColumnMapping[] {
    const mapping: ColumnMapping[] = [];
    const headerMap = this.getHeaderMap();

    headers.forEach((header) => {
      const cleanHeader = header.toLowerCase().trim();
      
      // Check custom mapping first
      if (this.config.columnMapping && this.config.columnMapping[header]) {
        const target = this.config.columnMapping[header] as keyof ParsedBOQItem;
        mapping.push({
          source: header,
          target,
          required: this.isRequiredField(target)
        });
      } else {
        // Try to match with default mapping
        const matchedField = this.findMatchingField(cleanHeader, headerMap);
        if (matchedField) {
          mapping.push({
            source: header,
            target: matchedField,
            required: this.isRequiredField(matchedField)
          });
        }
      }
    });

    return mapping;
  }

  /**
   * Convert array row to object using column mapping
   */
  arrayToObject(row: any[], mapping: ColumnMapping[]): RawBOQRow {
    const obj: RawBOQRow = {};
    
    mapping.forEach((map, index) => {
      if (row[index] !== undefined && row[index] !== '') {
        (obj as any)[map.target] = row[index];
      }
    });
    
    return obj;
  }

  /**
   * Get header mapping dictionary
   */
  private getHeaderMap(): Record<string, keyof ParsedBOQItem> {
    return {
      'line': 'lineNumber',
      'item': 'itemCode',
      'code': 'itemCode',
      'description': 'description',
      'desc': 'description',
      'unit': 'uom',
      'uom': 'uom',
      'quantity': 'quantity',
      'qty': 'quantity',
      'phase': 'phase',
      'task': 'task',
      'site': 'site',
      'location': 'site',
      'unit price': 'unitPrice',
      'rate': 'unitPrice',
      'total': 'totalPrice',
      'amount': 'totalPrice',
      'category': 'category',
      'subcategory': 'subcategory',
      'vendor': 'vendor',
      'supplier': 'vendor',
      'remarks': 'remarks',
      'notes': 'remarks'
    };
  }

  /**
   * Find matching field for header
   */
  private findMatchingField(
    cleanHeader: string,
    headerMap: Record<string, keyof ParsedBOQItem>
  ): keyof ParsedBOQItem | null {
    for (const [key, value] of Object.entries(headerMap)) {
      if (cleanHeader.includes(key)) {
        return value;
      }
    }
    return null;
  }

  /**
   * Check if field is required
   */
  private isRequiredField(field: keyof ParsedBOQItem): boolean {
    const requiredFields: (keyof ParsedBOQItem)[] = ['description', 'uom', 'quantity'];
    return requiredFields.includes(field);
  }

  /**
   * Get default column mapping
   */
  private getDefaultColumnMapping(): ColumnMapping[] {
    return [
      { source: 'A', target: 'lineNumber', required: false },
      { source: 'B', target: 'itemCode', required: false },
      { source: 'C', target: 'description', required: true },
      { source: 'D', target: 'uom', required: true },
      { source: 'E', target: 'quantity', required: true },
      { source: 'F', target: 'unitPrice', required: false },
      { source: 'G', target: 'totalPrice', required: false }
    ];
  }
}