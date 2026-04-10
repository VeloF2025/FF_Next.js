/**
 * Text Processing Utility for Catalog Matching
 * Handles text normalization, keyword extraction, and search variations
 */

// Pre-processing for text normalization
export class TextProcessor {
  private static stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'mm', 'cm', 'm', 'kg', 'g', 'ton', 'pcs', 'nos', 'each', 'pair', 'set', 'length', 'width',
    'diameter', 'thickness', 'size', 'grade', 'type', 'model', 'brand', 'make'
  ]);

  /**
   * Normalize text for better matching
   */
  static normalize(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, ' ') // Remove special characters except hyphens
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\b\d+\w*\b/g, '') // Remove standalone numbers with units
      .trim();
  }

  /**
   * Extract keywords from text
   */
  static extractKeywords(text: string): string[] {
    const normalized = this.normalize(text);
    const words = normalized.split(/\s+/);
    
    return words
      .filter(word => word.length > 2) // Remove short words
      .filter(word => !this.stopWords.has(word)) // Remove stop words
      .filter(word => !/^\d+$/.test(word)) // Remove pure numbers
      .map(word => word.replace(/s$/, '')) // Simple stemming (remove plural 's')
      .filter((word, index, array) => array.indexOf(word) === index); // Remove duplicates
  }

  /**
   * Generate search variations for a term
   */
  static generateVariations(text: string): string[] {
    const variations = new Set<string>();
    const normalized = this.normalize(text);
    
    variations.add(normalized);
    variations.add(text.toLowerCase().trim());
    
    // Add acronym if text has multiple words
    const words = normalized.split(/\s+/);
    if (words.length > 1) {
      const acronym = words.map(word => word[0]).join('');
      if (acronym.length > 1) {
        variations.add(acronym);
      }
    }
    
    // Add without common suffixes
    const withoutSuffixes = normalized
      .replace(/\b(cable|wire|cord|tube|pipe|fitting|joint|connector)s?\b/g, '')
      .trim();
    if (withoutSuffixes && withoutSuffixes !== normalized) {
      variations.add(withoutSuffixes);
    }
    
    return Array.from(variations).filter(v => v.length > 0);
  }

  /**
   * Calculate simple string similarity using Levenshtein distance
   */
  static similarity(str1: string, str2: string): number {
    const s1 = this.normalize(str1);
    const s2 = this.normalize(str2);
    
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;
    
    const matrix = Array(s2.length + 1).fill(null).map(() => 
      Array(s1.length + 1).fill(null)
    );
    
    for (let i = 0; i <= s1.length; i++) matrix[0]![i] = i;
    for (let j = 0; j <= s2.length; j++) matrix[j]![0] = j;
    
    for (let j = 1; j <= s2.length; j++) {
      for (let i = 1; i <= s1.length; i++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[j]![i] = Math.min(
          matrix[j]![i - 1] + 1,     // insertion
          matrix[j - 1]![i] + 1,     // deletion
          matrix[j - 1]![i - 1] + cost // substitution
        );
      }
    }
    
    const maxLength = Math.max(s1.length, s2.length);
    return (maxLength - matrix[s2.length]![s1.length]) / maxLength;
  }

  /**
   * Check if one string contains another (normalized)
   */
  static contains(haystack: string, needle: string): boolean {
    return this.normalize(haystack).includes(this.normalize(needle));
  }

  /**
   * Extract numeric values and units from text
   */
  static extractSpecs(text: string): { value: number; unit: string }[] {
    const specs: { value: number; unit: string }[] = [];
    const specRegex = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g;
    let match;
    
    while ((match = specRegex.exec(text)) !== null) {
      specs.push({
        value: parseFloat(match[1]),
        unit: match[2]!.toLowerCase()
      });
    }
    
    return specs;
  }
}