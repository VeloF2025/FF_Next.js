/**
 * BOQ Viewer Table Row Component
 */

import { Edit3, Save, X } from 'lucide-react';
import { BOQItem } from '@/types/procurement/boq.types';
import { getStatusBadge, getConfidenceIndicator } from './BOQViewerUtils';
import { EditingItem, VisibleColumns } from './BOQViewerTypes';

interface BOQViewerTableRowProps {
  item: BOQItem;
  mode: 'view' | 'edit';
  editing?: EditingItem | undefined;
  visibleColumns: VisibleColumns;
  onStartEdit: (item: BOQItem) => void;
  onCancelEdit: (itemId: string) => void;
  onUpdateEdit: (itemId: string, field: keyof BOQItem, value: unknown) => void;
  onSaveEdit: (itemId: string) => void;
  isSaving: boolean;
}

export default function BOQViewerTableRow({
  item,
  mode,
  editing,
  visibleColumns,
  onStartEdit,
  onCancelEdit,
  onUpdateEdit,
  onSaveEdit,
  isSaving
}: BOQViewerTableRowProps) {
  const isEditing = !!editing;

  return (
    <tr className="hover:bg-background">
      {mode === 'edit' && (
        <td className="px-6 py-4 whitespace-nowrap text-sm">
          {isEditing ? (
            <div className="flex items-center space-x-1">
              <button
                onClick={() => onSaveEdit(item.id)}
                disabled={isSaving}
                className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
              </button>
              <button
                onClick={() => onCancelEdit(item.id)}
                className="p-1 text-red-600 hover:text-red-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => onStartEdit(item)}
              className="p-1 text-muted-foreground hover:text-muted-foreground"
            >
              <Edit3 className="h-4 w-4" />
            </button>
          )}
        </td>
      )}
      
      {visibleColumns.lineNumber && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {item.lineNumber}
        </td>
      )}
      
      {visibleColumns.itemCode && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {isEditing ? (
            <input
              type="text"
              value={editing!.data.itemCode || ''}
              onChange={(e) => onUpdateEdit(item.id, 'itemCode', e.target.value)}
              className="w-full px-2 py-1 border border-border rounded text-sm"
            />
          ) : (
            item.itemCode || '-'
          )}
        </td>
      )}
      
      {visibleColumns.description && (
        <td className="px-6 py-4 text-sm text-foreground">
          {isEditing ? (
            <textarea
              value={editing!.data.description || ''}
              onChange={(e) => onUpdateEdit(item.id, 'description', e.target.value)}
              className="w-full px-2 py-1 border border-border rounded text-sm"
              rows={2}
            />
          ) : (
            <div className="max-w-xs truncate" title={item.description}>
              {item.description}
            </div>
          )}
        </td>
      )}
      
      {visibleColumns.category && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {item.category || '-'}
        </td>
      )}
      
      {visibleColumns.quantity && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {isEditing ? (
            <input
              type="number"
              value={editing!.data.quantity || ''}
              onChange={(e) => onUpdateEdit(item.id, 'quantity', parseFloat(e.target.value))}
              className="w-20 px-2 py-1 border border-border rounded text-sm"
            />
          ) : (
            item.quantity.toLocaleString()
          )}
        </td>
      )}
      
      {visibleColumns.uom && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {item.uom}
        </td>
      )}
      
      {visibleColumns.unitPrice && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {isEditing ? (
            <input
              type="number"
              step="0.01"
              value={editing!.data.unitPrice || ''}
              onChange={(e) => onUpdateEdit(item.id, 'unitPrice', parseFloat(e.target.value))}
              className="w-24 px-2 py-1 border border-border rounded text-sm"
            />
          ) : (
            item.unitPrice ? `R${item.unitPrice.toFixed(2)}` : '-'
          )}
        </td>
      )}
      
      {visibleColumns.totalPrice && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {item.totalPrice ? `R${item.totalPrice.toFixed(2)}` : '-'}
        </td>
      )}
      
      {visibleColumns.mappingStatus && (
        <td className="px-6 py-4 whitespace-nowrap">
          <div className="flex items-center space-x-2">
            <span className={getStatusBadge(item.mappingStatus, 'mapping')}>
              {item.mappingStatus}
            </span>
            {getConfidenceIndicator(item.mappingConfidence)}
          </div>
        </td>
      )}
      
      {visibleColumns.procurementStatus && (
        <td className="px-6 py-4 whitespace-nowrap">
          <span className={getStatusBadge(item.procurementStatus, 'procurement')}>
            {item.procurementStatus.replace('_', ' ')}
          </span>
        </td>
      )}
      
      {visibleColumns.phase && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {item.phase || '-'}
        </td>
      )}
      
      {visibleColumns.task && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {item.task || '-'}
        </td>
      )}
      
      {visibleColumns.site && (
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
          {item.site || '-'}
        </td>
      )}
    </tr>
  );
}