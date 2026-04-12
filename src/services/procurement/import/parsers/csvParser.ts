/**
 * CSV Parser
 * Handles CSV file parsing and line processing
 */

/**
 * CSV file parsing utilities
 */
export class CSVParser {
  /**
   * Read CSV file and return array of rows
   */
  static async parseCSVFile(file: File): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          if (!text) {
            resolve([]);
            return;
          }

          const lines = text.split(/\r?\n/).filter(line => line.trim());
          if (lines.length === 0) {
            resolve([]);
            return;
          }

          // Parse CSV lines
          const data = lines.map(line => this.parseCSVLine(line));

          // Convert to object format using first row as headers
          const headers = data[0]!;
          const rows = data.slice(1).map(row => {
            const obj: Record<string, string> = {};
            headers.forEach((header, index) => {
              obj[header] = row[index] || '';
            });
            return obj;
          });

          resolve(rows);
        } catch (error) {
          reject(new Error(`Failed to parse CSV file: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read CSV file'));
      reader.readAsText(file);
    });
  }

  /**
   * Parse a single CSV line handling quoted values and escapes
   */
  static parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote inside quoted string
          current += '"';
          i += 2; // Skip both quotes
          continue;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator outside quotes
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
      
      i++;
    }
    
    // Add the last field
    result.push(current.trim());
    
    // Remove surrounding quotes from fields
    return result.map(field => {
      if (field.startsWith('"') && field.endsWith('"')) {
        return field.slice(1, -1);
      }
      return field;
    });
  }

  /**
   * Parse CSV with custom delimiter
   */
  static parseCSVWithDelimiter(file: File, delimiter: string = ','): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          if (!text) {
            resolve([]);
            return;
          }

          const lines = text.split(/\r?\n/).filter(line => line.trim());
          if (lines.length === 0) {
            resolve([]);
            return;
          }

          // Parse lines with custom delimiter
          const data = lines.map(line => this.parseLineWithDelimiter(line, delimiter));

          // Convert to object format
          const headers = data[0]!;
          const rows = data.slice(1).map(row => {
            const obj: Record<string, string> = {};
            headers.forEach((header, index) => {
              obj[header] = row[index] || '';
            });
            return obj;
          });

          resolve(rows);
        } catch (error) {
          reject(new Error(`Failed to parse CSV with delimiter: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read CSV file'));
      reader.readAsText(file);
    });
  }

  /**
   * Parse line with custom delimiter
   */
  private static parseLineWithDelimiter(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
      
      i++;
    }
    
    result.push(current.trim());
    
    return result.map(field => {
      if (field.startsWith('"') && field.endsWith('"')) {
        return field.slice(1, -1);
      }
      return field;
    });
  }

  /**
   * Detect CSV delimiter automatically
   */
  static detectDelimiter(text: string): string {
    const delimiters = [',', ';', '\t', '|'];
    const testLines = text.split(/\r?\n/).slice(0, 5); // Test first 5 lines
    
    let maxConsistency = 0;
    let bestDelimiter = ',';
    
    for (const delimiter of delimiters) {
      const counts = testLines.map(line => {
        let count = 0;
        let inQuotes = false;
        
        for (const char of line) {
          if (char === '"') inQuotes = !inQuotes;
          if (char === delimiter && !inQuotes) count++;
        }
        
        return count;
      }).filter(count => count > 0);
      
      if (counts.length === 0) continue;
      
      // Check consistency of delimiter count across lines
      const avgCount = counts.reduce((sum, count) => sum + count, 0) / counts.length;
      const variance = counts.reduce((sum, count) => sum + Math.pow(count - avgCount, 2), 0) / counts.length;
      const consistency = avgCount / (1 + variance);
      
      if (consistency > maxConsistency) {
        maxConsistency = consistency;
        bestDelimiter = delimiter;
      }
    }
    
    return bestDelimiter;
  }

  /**
   * Parse CSV from text string
   */
  static parseCSVText(text: string, delimiter?: string): Record<string, string>[] {
    if (!text.trim()) return [];

    const detectedDelimiter = delimiter || this.detectDelimiter(text);
    const lines = text.split(/\r?\n/).filter(line => line.trim());

    if (lines.length === 0) return [];

    const data = lines.map(line => this.parseLineWithDelimiter(line, detectedDelimiter));
    const headers = data[0]!;

    return data.slice(1).map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });
  }

  /**
   * Validate CSV structure
   */
  static validateCSV(data: string[][]): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (data.length === 0) {
      errors.push('CSV file is empty');
      return { isValid: false, errors };
    }
    
    const headerCount = data[0]!.length;

    if (headerCount === 0) {
      errors.push('CSV file has no columns');
    }

    // Check for consistent column count
    for (let i = 1; i < data.length; i++) {
      if (data[i]!.length !== headerCount) {
        errors.push(`Row ${i + 1} has ${data[i]!.length} columns, expected ${headerCount}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}