/**
 * Encoding Detector
 * Detects file encoding and character sets
 */

/**
 * File encoding detection utilities
 */
export class EncodingDetector {
  /**
   * Detect file encoding for better text processing
   */
  static detectFileEncoding(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Simple BOM detection
        if (uint8Array.length >= 3 && 
            uint8Array[0] === 0xEF && 
            uint8Array[1] === 0xBB && 
            uint8Array[2] === 0xBF) {
          resolve('UTF-8');
          return;
        }
        
        if (uint8Array.length >= 2) {
          if (uint8Array[0] === 0xFF && uint8Array[1] === 0xFE) {
            resolve('UTF-16LE');
            return;
          }
          if (uint8Array[0] === 0xFE && uint8Array[1] === 0xFF) {
            resolve('UTF-16BE');
            return;
          }
        }
        
        // Check for UTF-32 BOMs
        if (uint8Array.length >= 4) {
          if (uint8Array[0] === 0xFF && uint8Array[1] === 0xFE && 
              uint8Array[2] === 0x00 && uint8Array[3] === 0x00) {
            resolve('UTF-32LE');
            return;
          }
          if (uint8Array[0] === 0x00 && uint8Array[1] === 0x00 && 
              uint8Array[2] === 0xFE && uint8Array[3] === 0xFF) {
            resolve('UTF-32BE');
            return;
          }
        }
        
        // Default to UTF-8
        resolve('UTF-8');
      };

      reader.onerror = () => resolve('UTF-8');
      
      // Read only first 4 bytes for BOM detection
      const blob = file.slice(0, 4);
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * Detect character encoding by analyzing byte patterns
   */
  static async detectEncodingAdvanced(file: File): Promise<{
    encoding: string;
    confidence: number;
    bom: boolean;
  }> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const uint8Array = new Uint8Array(arrayBuffer);
        let encoding = 'UTF-8';
        let confidence = 0.5;
        let bom = false;
        
        // Check for BOM first
        const bomResult = this.detectBOM(uint8Array);
        if (bomResult.encoding) {
          encoding = bomResult.encoding;
          confidence = 1.0;
          bom = true;
        } else {
          // Analyze byte patterns for encoding detection
          const analysis = this.analyzeBytePatterns(uint8Array);
          encoding = analysis.encoding;
          confidence = analysis.confidence;
        }
        
        resolve({ encoding, confidence, bom });
      };

      reader.onerror = () => resolve({ encoding: 'UTF-8', confidence: 0.5, bom: false });
      
      // Read first 1KB for analysis
      const blob = file.slice(0, 1024);
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * Detect Byte Order Mark (BOM)
   */
  private static detectBOM(uint8Array: Uint8Array): { encoding: string | null } {
    if (uint8Array.length >= 3 && 
        uint8Array[0] === 0xEF && uint8Array[1] === 0xBB && uint8Array[2] === 0xBF) {
      return { encoding: 'UTF-8' };
    }
    
    if (uint8Array.length >= 2) {
      if (uint8Array[0] === 0xFF && uint8Array[1] === 0xFE) {
        return { encoding: 'UTF-16LE' };
      }
      if (uint8Array[0] === 0xFE && uint8Array[1] === 0xFF) {
        return { encoding: 'UTF-16BE' };
      }
    }
    
    if (uint8Array.length >= 4) {
      if (uint8Array[0] === 0xFF && uint8Array[1] === 0xFE && 
          uint8Array[2] === 0x00 && uint8Array[3] === 0x00) {
        return { encoding: 'UTF-32LE' };
      }
      if (uint8Array[0] === 0x00 && uint8Array[1] === 0x00 && 
          uint8Array[2] === 0xFE && uint8Array[3] === 0xFF) {
        return { encoding: 'UTF-32BE' };
      }
    }
    
    return { encoding: null };
  }

  /**
   * Analyze byte patterns to detect encoding
   */
  private static analyzeBytePatterns(uint8Array: Uint8Array): {
    encoding: string;
    confidence: number;
  } {
    let asciiCount = 0;
    let utf8Count = 0;
    let binaryCount = 0;
    
    for (let i = 0; i < uint8Array.length; i++) {
      const byte = uint8Array[i]!;

      if (byte <= 0x7F) {
        asciiCount++;
      } else if (byte <= 0xBF) {
        // Likely continuation byte
        binaryCount++;
      } else if (byte <= 0xDF) {
        // 2-byte UTF-8 sequence start
        if (i + 1 < uint8Array.length &&
            uint8Array[i + 1]! >= 0x80 && uint8Array[i + 1]! <= 0xBF) {
          utf8Count += 2;
          i++; // Skip next byte
        } else {
          binaryCount++;
        }
      } else if (byte <= 0xEF) {
        // 3-byte UTF-8 sequence start
        if (i + 2 < uint8Array.length &&
            uint8Array[i + 1]! >= 0x80 && uint8Array[i + 1]! <= 0xBF &&
            uint8Array[i + 2]! >= 0x80 && uint8Array[i + 2]! <= 0xBF) {
          utf8Count += 3;
          i += 2; // Skip next two bytes
        } else {
          binaryCount++;
        }
      } else {
        binaryCount++;
      }
    }
    
    const total = uint8Array.length;
    const asciiRatio = asciiCount / total;
    const utf8Ratio = (asciiCount + utf8Count) / total;
    const binaryRatio = binaryCount / total;
    
    if (asciiRatio > 0.95) {
      return { encoding: 'ASCII', confidence: 0.95 };
    } else if (utf8Ratio > 0.8) {
      return { encoding: 'UTF-8', confidence: 0.8 };
    } else if (binaryRatio > 0.3) {
      return { encoding: 'BINARY', confidence: 0.7 };
    } else {
      return { encoding: 'UTF-8', confidence: 0.5 };
    }
  }

  /**
   * Check if file appears to be binary
   */
  static async isBinaryFile(file: File): Promise<boolean> {
    const encoding = await this.detectEncodingAdvanced(file);
    return encoding.encoding === 'BINARY';
  }

  /**
   * Get supported encodings list
   */
  static getSupportedEncodings(): string[] {
    return ['UTF-8', 'UTF-16LE', 'UTF-16BE', 'UTF-32LE', 'UTF-32BE', 'ASCII'];
  }
}
