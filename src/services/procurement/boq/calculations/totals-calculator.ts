/**
 * BOQ Totals Calculator
 * Handles calculation of totals, statistics, and category breakdowns
 */

interface BOQItemInput {
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
  category?: string;
}

/**
 * BOQ Totals and Statistics Calculator
 */
export class BOQTotalsCalculator {
  /**
   * Calculate BOQ totals and statistics
   */
  static calculateBOQTotals(items: BOQItemInput[]): {
    totalItems: number;
    totalQuantity: number;
    totalValue: number;
    averageUnitPrice: number;
    categoryBreakdown: Record<string, {
      itemCount: number;
      totalQuantity: number;
      totalValue: number;
    }>;
  } {
    const totals = {
      totalItems: items.length,
      totalQuantity: 0,
      totalValue: 0,
      averageUnitPrice: 0,
      categoryBreakdown: {} as Record<string, { itemCount: number; totalQuantity: number; totalValue: number }>
    };

    const categoryMap = new Map<string, {
      itemCount: number;
      totalQuantity: number;
      totalValue: number;
    }>();

    items.forEach(item => {
      const quantity = item.quantity || 0;
      const unitPrice = item.unitPrice || 0;
      const totalPrice = item.totalPrice || (quantity * unitPrice);

      totals.totalQuantity += quantity;
      totals.totalValue += totalPrice;

      // Category breakdown
      const category = item.category || 'Uncategorized';
      if (!categoryMap.has(category)) {
        categoryMap.set(category, {
          itemCount: 0,
          totalQuantity: 0,
          totalValue: 0
        });
      }

      const categoryData = categoryMap.get(category)!;
      categoryData.itemCount++;
      categoryData.totalQuantity += quantity;
      categoryData.totalValue += totalPrice;
    });

    totals.averageUnitPrice = totals.totalItems > 0 ? totals.totalValue / totals.totalQuantity : 0;
    totals.categoryBreakdown = Object.fromEntries(categoryMap);

    return totals;
  }

  /**
   * Generate BOQ cost breakdown
   */
  static generateCostBreakdown(items: BOQItemInput[]): {
    labor: number;
    materials: number;
    equipment: number;
    other: number;
    total: number;
    laborPercentage: number;
    materialsPercentage: number;
    equipmentPercentage: number;
    otherPercentage: number;
  } {
    const breakdown = {
      labor: 0,
      materials: 0,
      equipment: 0,
      other: 0,
      total: 0,
      laborPercentage: 0,
      materialsPercentage: 0,
      equipmentPercentage: 0,
      otherPercentage: 0
    };

    items.forEach(item => {
      const value = item.totalPrice || ((item.quantity ?? 0) * (item.unitPrice ?? 0)) || 0;
      const category = (item.category || '').toLowerCase();

      if (category.includes('labor') || category.includes('manpower')) {
        breakdown.labor += value;
      } else if (category.includes('material') || category.includes('supply')) {
        breakdown.materials += value;
      } else if (category.includes('equipment') || category.includes('machinery')) {
        breakdown.equipment += value;
      } else {
        breakdown.other += value;
      }
    });

    breakdown.total = breakdown.labor + breakdown.materials + breakdown.equipment + breakdown.other;

    if (breakdown.total > 0) {
      breakdown.laborPercentage = (breakdown.labor / breakdown.total) * 100;
      breakdown.materialsPercentage = (breakdown.materials / breakdown.total) * 100;
      breakdown.equipmentPercentage = (breakdown.equipment / breakdown.total) * 100;
      breakdown.otherPercentage = (breakdown.other / breakdown.total) * 100;
    }

    return breakdown;
  }

  /**
   * Calculate BOQ completion percentage
   */
  static calculateCompletionPercentage(
    totalItems: number,
    completedItems: number,
    inProgressItems: number = 0
  ): {
    completionPercentage: number;
    progressPercentage: number;
    remainingItems: number;
    status: 'not_started' | 'in_progress' | 'completed';
  } {
    const completionPercentage = totalItems > 0 ? 
      (completedItems / totalItems) * 100 : 0;
    
    const progressPercentage = totalItems > 0 ? 
      ((completedItems + inProgressItems) / totalItems) * 100 : 0;

    let status: 'not_started' | 'in_progress' | 'completed' = 'not_started';
    
    if (completionPercentage === 100) {
      status = 'completed';
    } else if (completedItems > 0 || inProgressItems > 0) {
      status = 'in_progress';
    }

    return {
      completionPercentage,
      progressPercentage,
      remainingItems: totalItems - completedItems,
      status
    };
  }
}