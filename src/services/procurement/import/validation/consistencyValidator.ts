/**
 * Consistency Validator
 * Validates data consistency across all BOQ items
 */

import type { ImportError, ImportWarning, ParsedBOQItem } from '../importTypes';

/**
 * Validate data consistency across all BOQ items
 */
export function validateDataConsistency(items: ParsedBOQItem[]): {
  errors: ImportError[];
  warnings: ImportWarning[];
} {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const seenLineNumbers = new Set<number>();
  const itemCodes = new Set<string>();

  // Track UOM usage per category
  const categoryUOMs = new Map<string, Set<string>>();
  
  // Track similar descriptions
  const descriptions = new Map<string, number[]>();

  items.forEach((item, index) => {
    const rowNumber = index + 1;

    // Check for duplicate line numbers
    if (seenLineNumbers.has(item.lineNumber)) {
      errors.push({
        type: 'validation',
        row: rowNumber,
        column: 'lineNumber',
        message: `Duplicate line number: ${item.lineNumber}`
      });
    } else {
      seenLineNumbers.add(item.lineNumber);
    }

    // Track item code duplicates
    if (item.itemCode) {
      if (itemCodes.has(item.itemCode)) {
        warnings.push({
          type: 'data',
          row: rowNumber,
          column: 'itemCode',
          message: `Duplicate item code: ${item.itemCode}`,
          suggestion: 'Consider using unique item codes'
        });
      } else {
        itemCodes.add(item.itemCode);
      }
    }

    // Track UOM consistency within categories
    if (item.category && item.uom) {
      if (!categoryUOMs.has(item.category)) {
        categoryUOMs.set(item.category, new Set());
      }
      categoryUOMs.get(item.category)!.add(item.uom);
    }
    
    // Track similar descriptions
    const normalizedDesc = item.description.toLowerCase().trim();
    if (!descriptions.has(normalizedDesc)) {
      descriptions.set(normalizedDesc, []);
    }
    descriptions.get(normalizedDesc)!.push(rowNumber);
  });

  // Check for UOM inconsistencies within categories
  categoryUOMs.forEach((uoms, category) => {
    if (uoms.size > 3) { // More than 3 different UOMs in same category
      warnings.push({
        type: 'data',
        row: 0,
        message: `Category "${category}" uses ${uoms.size} different units of measure: ${Array.from(uoms).join(', ')}`,
        suggestion: 'Consider standardizing units within categories'
      });
    }
  });
  
  // Check for duplicate descriptions
  descriptions.forEach((rows, description) => {
    if (rows.length > 1) {
      warnings.push({
        type: 'data',
        row: 0,
        message: `Duplicate description "${description}" found in rows: ${rows.join(', ')}`,
        suggestion: 'Consider making descriptions unique or consolidating duplicate items'
      });
    }
  });

  return { errors, warnings };
}

/**
 * Validate line number sequence
 */
export function validateLineNumberSequence(items: ParsedBOQItem[]): {
  errors: ImportError[];
  warnings: ImportWarning[];
} {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  
  const lineNumbers = items.map(item => item.lineNumber).sort((a, b) => a - b);
  const gaps: number[] = [];
  
  for (let i = 1; i < lineNumbers.length; i++) {
    const current = lineNumbers[i]!;
    const previous = lineNumbers[i - 1]!;
    const expectedNext = previous + 1;

    if (current !== expectedNext && current > expectedNext) {
      // There's a gap in the sequence
      for (let missing = expectedNext; missing < current; missing++) {
        gaps.push(missing);
      }
    }
  }
  
  if (gaps.length > 0) {
    warnings.push({
      type: 'data',
      row: 0,
      message: `Missing line numbers in sequence: ${gaps.join(', ')}`,
      suggestion: 'Consider using consecutive line numbers for better organization'
    });
  }
  
  return { errors, warnings };
}

/**
 * Validate price consistency across similar items
 */
export function validatePriceConsistency(items: ParsedBOQItem[]): {
  errors: ImportError[];
  warnings: ImportWarning[];
} {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  
  // Group items by description and UOM with their original index
  interface ItemWithIndex {
    item: ParsedBOQItem;
    index: number;
  }
  
  const itemGroups = new Map<string, ItemWithIndex[]>();
  
  items.forEach((item, index) => {
    const key = `${item.description.toLowerCase().trim()}|${item.uom.toLowerCase()}`;
    if (!itemGroups.has(key)) {
      itemGroups.set(key, []);
    }
    itemGroups.get(key)!.push({ item, index });
  });
  
  // Check for price variations within similar items
  itemGroups.forEach((groupItems, key) => {
    if (groupItems.length < 2) return;
    
    const prices = groupItems
      .filter(itemWithIndex => itemWithIndex.item.unitPrice && itemWithIndex.item.unitPrice > 0)
      .map(itemWithIndex => itemWithIndex.item.unitPrice!);
    
    if (prices.length < 2) return;
    
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceVariation = (maxPrice - minPrice) / minPrice;
    
    // If price variation is more than 20%, flag as warning
    if (priceVariation > 0.2) {
      const [description] = key.split('|');
      warnings.push({
        type: 'data',
        row: 0,
        message: `Price variation detected for "${description}": ${minPrice.toFixed(2)} - ${maxPrice.toFixed(2)} (${(priceVariation * 100).toFixed(1)}% difference)`,
        suggestion: 'Review pricing for similar items to ensure consistency'
      });
    }
  });
  
  return { errors, warnings };
}

/**
 * Validate category and classification consistency
 */
export function validateCategoryConsistency(items: ParsedBOQItem[]): {
  errors: ImportError[];
  warnings: ImportWarning[];
} {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  
  // Group items by similar keywords in description
  const keywordCategories = new Map<string, { items: ParsedBOQItem[]; categories: Set<string> }>();
  
  items.forEach(item => {
    const description = item.description.toLowerCase();
    const words = description.split(' ').filter(word => word.length > 3); // Only meaningful words
    
    words.forEach(word => {
      if (!keywordCategories.has(word)) {
        keywordCategories.set(word, { items: [], categories: new Set() });
      }
      keywordCategories.get(word)!.items.push(item);
      if (item.category) {
        keywordCategories.get(word)!.categories.add(item.category);
      }
    });
  });
  
  // Find keywords that appear in multiple categories
  keywordCategories.forEach(({ items: keywordItems, categories }, keyword) => {
    if (categories.size > 1 && keywordItems.length > 2) {
      warnings.push({
        type: 'data',
        row: 0,
        message: `Items containing "${keyword}" are categorized inconsistently across: ${Array.from(categories).join(', ')}`,
        suggestion: 'Consider standardizing categorization for similar items'
      });
    }
  });
  
  return { errors, warnings };
}
