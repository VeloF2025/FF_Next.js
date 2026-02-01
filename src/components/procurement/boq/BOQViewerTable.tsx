/**
 * BOQ Viewer Table Component
 */

import { ArrowUpDown } from 'lucide-react';
import { BOQItem } from '@/types/procurement/boq.types';
import { EditingItem, SortField, VisibleColumns } from './BOQViewerTypes';
import BOQViewerTableRow from './BOQViewerTableRow';

interface BOQViewerTableProps {
  items: BOQItem[];
  mode: 'view' | 'edit';
  editingItems: Map<string, EditingItem>;
  visibleColumns: VisibleColumns;
  sortField: SortField;
  onSort: (field: SortField) => void;
  onStartEdit: (item: BOQItem) => void;
  onCancelEdit: (itemId: string) => void;
  onUpdateEdit: (itemId: string, field: keyof BOQItem, value: unknown) => void;
  onSaveEdit: (itemId: string) => void;
  isSaving: boolean;
}

export default function BOQViewerTable({
  items,
  mode,
  editingItems,
  visibleColumns,
  sortField,
  onSort,
  onStartEdit,
  onCancelEdit,
  onUpdateEdit,
  onSaveEdit,
  isSaving
}: BOQViewerTableProps) {
  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => onSort(field)}
      className={`flex items-center space-x-1 hover:text-[var(--ff-text-secondary)] ${
        sortField === field ? 'text-[var(--ff-text-primary)] font-medium' : 'text-[var(--ff-text-tertiary)]'
      }`}
    >
      <span>{label}</span>
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
        <thead className="bg-[var(--ff-bg-tertiary)]">
          <tr>
            {mode === 'edit' && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                Actions
              </th>
            )}

            {visibleColumns.lineNumber && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                <SortButton field="lineNumber" label="Line #" />
              </th>
            )}

            {visibleColumns.itemCode && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                Item Code
              </th>
            )}

            {visibleColumns.description && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                <SortButton field="description" label="Description" />
              </th>
            )}

            {visibleColumns.category && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                Category
              </th>
            )}

            {visibleColumns.quantity && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                <SortButton field="quantity" label="Quantity" />
              </th>
            )}

            {visibleColumns.uom && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                UOM
              </th>
            )}

            {visibleColumns.unitPrice && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                <SortButton field="unitPrice" label="Unit Price" />
              </th>
            )}

            {visibleColumns.totalPrice && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                <SortButton field="totalPrice" label="Total Price" />
              </th>
            )}

            {visibleColumns.mappingStatus && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                <SortButton field="mappingConfidence" label="Mapping" />
              </th>
            )}

            {visibleColumns.procurementStatus && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                Procurement
              </th>
            )}

            {visibleColumns.phase && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                Phase
              </th>
            )}

            {visibleColumns.task && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                Task
              </th>
            )}

            {visibleColumns.site && (
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                Site
              </th>
            )}
          </tr>
        </thead>

        <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
          {items.map((item) => (
            <BOQViewerTableRow
              key={item.id}
              item={item}
              mode={mode}
              editing={editingItems.get(item.id)}
              visibleColumns={visibleColumns}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onUpdateEdit={onUpdateEdit}
              onSaveEdit={onSaveEdit}
              isSaving={isSaving}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}