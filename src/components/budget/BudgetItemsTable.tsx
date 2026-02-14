/**
 * Budget Items Table Component
 * Displays item-level budget data with sorting, filtering, and category grouping
 */

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Search, Package, AlertTriangle } from 'lucide-react';
import type { BudgetItemWithCategory } from '@/types/procurement/material-catalog.types';

interface BudgetItemsTableProps {
  items: BudgetItemWithCategory[];
  currency?: string;
  loading?: boolean;
  onItemClick?: (item: BudgetItemWithCategory) => void;
}

type SortField = 'itemCode' | 'description' | 'budgetedAmount' | 'varianceAmount' | 'categoryCode';
type SortOrder = 'asc' | 'desc';

export function BudgetItemsTable({
  items,
  currency = 'ZAR',
  loading = false,
  onItemClick,
}: BudgetItemsTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('categoryCode');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [groupByCategory, setGroupByCategory] = useState(true);

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Filter and sort items
  const filteredItems = useMemo(() => {
    let result = [...items];

    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (item) =>
          item.description.toLowerCase().includes(searchLower) ||
          (item.itemCode && item.itemCode.toLowerCase().includes(searchLower)) ||
          (item.categoryCode && item.categoryCode.toLowerCase().includes(searchLower))
      );
    }

    // Sort
    result.sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      switch (sortField) {
        case 'itemCode':
          aVal = a.itemCode || '';
          bVal = b.itemCode || '';
          break;
        case 'description':
          aVal = a.description;
          bVal = b.description;
          break;
        case 'budgetedAmount':
          aVal = a.budgetedAmount;
          bVal = b.budgetedAmount;
          break;
        case 'varianceAmount':
          aVal = a.varianceAmount;
          bVal = b.varianceAmount;
          break;
        case 'categoryCode':
          aVal = a.categoryCode || '';
          bVal = b.categoryCode || '';
          break;
      }

      if (typeof aVal === 'string') {
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal);
      }
      return sortOrder === 'asc' ? aVal - (bVal as number) : (bVal as number) - aVal;
    });

    return result;
  }, [items, search, sortField, sortOrder]);

  // Group by category
  const groupedItems = useMemo(() => {
    if (!groupByCategory) return null;

    const groups = new Map<string, { items: BudgetItemWithCategory[]; totals: { budgeted: number; actual: number; variance: number } }>();

    for (const item of filteredItems) {
      const key = item.categoryCode || 'UNCATEGORIZED';
      if (!groups.has(key)) {
        groups.set(key, { items: [], totals: { budgeted: 0, actual: 0, variance: 0 } });
      }
      const group = groups.get(key)!;
      group.items.push(item);
      group.totals.budgeted += item.budgetedAmount;
      group.totals.actual += item.actualAmount;
      group.totals.variance += item.varianceAmount;
    }

    return groups;
  }, [filteredItems, groupByCategory]);

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Toggle category expansion
  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  // Expand all categories
  const expandAll = () => {
    if (groupedItems) {
      setExpandedCategories(new Set(groupedItems.keys()));
    }
  };

  // Collapse all categories
  const collapseAll = () => {
    setExpandedCategories(new Set());
  };

  // Get variance color
  const getVarianceColor = (variance: number) => {
    if (variance < 0) return 'text-red-600 dark:text-red-400';
    if (variance > 0) return 'text-green-600 dark:text-green-400';
    return 'text-muted-foreground';
  };

  // Sort indicator
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) {
    return (
      <div className="bg-card rounded-lg border border-border p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-secondary rounded w-1/3"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-secondary rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-8 text-center">
        <Package className="h-12 w-12 mx-auto text-gray-400 dark:text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">No Budget Items</h3>
        <p className="text-muted-foreground">
          Import a BOQ to create budget items for tracking.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border shadow-sm">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h3 className="text-lg font-semibold text-foreground">
            Budget Items ({filteredItems.length})
          </h3>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-48"
              />
            </div>
            {/* Group toggle */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={groupByCategory}
                onChange={(e) => setGroupByCategory(e.target.checked)}
                className="rounded border-border text-blue-600 focus:ring-blue-500"
              />
              Group by category
            </label>
            {groupByCategory && (
              <div className="flex gap-1">
                <button
                  onClick={expandAll}
                  className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Expand All
                </button>
                <button
                  onClick={collapseAll}
                  className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Collapse All
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th
                onClick={() => handleSort('itemCode')}
                className="text-left py-3 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              >
                Item Code <SortIndicator field="itemCode" />
              </th>
              <th
                onClick={() => handleSort('description')}
                className="text-left py-3 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              >
                Description <SortIndicator field="description" />
              </th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">UOM</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Qty</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Rate</th>
              <th
                onClick={() => handleSort('budgetedAmount')}
                className="text-right py-3 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              >
                Budgeted <SortIndicator field="budgetedAmount" />
              </th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actual</th>
              <th
                onClick={() => handleSort('varianceAmount')}
                className="text-right py-3 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
              >
                Variance <SortIndicator field="varianceAmount" />
              </th>
            </tr>
          </thead>
          <tbody>
            {groupByCategory && groupedItems ? (
              // Grouped view
              [...groupedItems.entries()].map(([category, group]) => (
                <CategoryGroup
                  key={category}
                  category={category}
                  categoryName={group.items[0]?.categoryName || category}
                  items={group.items}
                  totals={group.totals}
                  expanded={expandedCategories.has(category)}
                  onToggle={() => toggleCategory(category)}
                  formatCurrency={formatCurrency}
                  getVarianceColor={getVarianceColor}
                  onItemClick={onItemClick}
                />
              ))
            ) : (
              // Flat view
              filteredItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  formatCurrency={formatCurrency}
                  getVarianceColor={getVarianceColor}
                  onClick={() => onItemClick?.(item)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Summary Footer */}
      <div className="p-4 border-t border-border bg-background">
        <div className="flex justify-end gap-8 text-sm">
          <div>
            <span className="text-muted-foreground">Total Budgeted:</span>
            <span className="ml-2 font-semibold text-foreground">
              {formatCurrency(filteredItems.reduce((sum, i) => sum + i.budgetedAmount, 0))}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Total Actual:</span>
            <span className="ml-2 font-semibold text-foreground">
              {formatCurrency(filteredItems.reduce((sum, i) => sum + i.actualAmount, 0))}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Total Variance:</span>
            <span
              className={`ml-2 font-semibold ${getVarianceColor(
                filteredItems.reduce((sum, i) => sum + i.varianceAmount, 0)
              )}`}
            >
              {formatCurrency(filteredItems.reduce((sum, i) => sum + i.varianceAmount, 0))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Category group component
function CategoryGroup({
  category,
  categoryName,
  items,
  totals,
  expanded,
  onToggle,
  formatCurrency,
  getVarianceColor,
  onItemClick,
}: {
  category: string;
  categoryName: string;
  items: BudgetItemWithCategory[];
  totals: { budgeted: number; actual: number; variance: number };
  expanded: boolean;
  onToggle: () => void;
  formatCurrency: (amount: number) => string;
  getVarianceColor: (variance: number) => string;
  onItemClick?: (item: BudgetItemWithCategory) => void;
}) {
  return (
    <>
      {/* Category header row */}
      <tr
        onClick={onToggle}
        className="bg-secondary/50 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
      >
        <td colSpan={2} className="py-2 px-4 font-medium text-foreground">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 rounded">
              {category}
            </span>
            <span>{categoryName}</span>
            <span className="text-muted-foreground font-normal">({items.length} items)</span>
          </div>
        </td>
        <td colSpan={2}></td>
        <td className="py-2 px-4 text-right font-medium text-muted-foreground"></td>
        <td className="py-2 px-4 text-right font-medium text-foreground">
          {formatCurrency(totals.budgeted)}
        </td>
        <td className="py-2 px-4 text-right font-medium text-foreground">
          {formatCurrency(totals.actual)}
        </td>
        <td className={`py-2 px-4 text-right font-medium ${getVarianceColor(totals.variance)}`}>
          {formatCurrency(totals.variance)}
        </td>
      </tr>
      {/* Items in category */}
      {expanded &&
        items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            formatCurrency={formatCurrency}
            getVarianceColor={getVarianceColor}
            onClick={() => onItemClick?.(item)}
            indent
          />
        ))}
    </>
  );
}

// Item row component
function ItemRow({
  item,
  formatCurrency,
  getVarianceColor,
  onClick,
  indent = false,
}: {
  item: BudgetItemWithCategory;
  formatCurrency: (amount: number) => string;
  getVarianceColor: (variance: number) => string;
  onClick?: () => void;
  indent?: boolean;
}) {
  const hasVarianceWarning = item.varianceAmount < 0;

  return (
    <tr
      onClick={onClick}
      className={`border-b border-gray-100 dark:border-gray-700 hover:bg-accent/30 ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      <td className={`py-2 px-4 text-muted-foreground ${indent ? 'pl-10' : ''}`}>
        {item.itemCode || '-'}
      </td>
      <td className="py-2 px-4 text-foreground max-w-xs truncate" title={item.description}>
        <div className="flex items-center gap-2">
          {hasVarianceWarning && <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />}
          <span className="truncate">{item.description}</span>
        </div>
      </td>
      <td className="py-2 px-4 text-muted-foreground">{item.uom || '-'}</td>
      <td className="py-2 px-4 text-right text-muted-foreground">
        {item.budgetedQuantity.toLocaleString()}
      </td>
      <td className="py-2 px-4 text-right text-muted-foreground">
        {formatCurrency(item.budgetedRate)}
      </td>
      <td className="py-2 px-4 text-right text-foreground font-medium">
        {formatCurrency(item.budgetedAmount)}
      </td>
      <td className="py-2 px-4 text-right text-muted-foreground">
        {formatCurrency(item.actualAmount)}
      </td>
      <td className={`py-2 px-4 text-right font-medium ${getVarianceColor(item.varianceAmount)}`}>
        {formatCurrency(item.varianceAmount)}
      </td>
    </tr>
  );
}

export default BudgetItemsTable;
