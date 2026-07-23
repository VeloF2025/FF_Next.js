/**
 * Checklist Items Editor - editable table of checklist items for a template
 */

import { Plus, Trash2 } from 'lucide-react';
import { SEVERITY_CONFIG } from '@/modules/health-safety/types/checklist.types';
import type { ChecklistCategory, ItemSeverity } from '@/modules/health-safety/types/checklist.types';

export interface EditableChecklistItem {
  id?: string;
  item_text: string;
  category: ChecklistCategory;
  severity: ItemSeverity;
  regulation_reference: string;
  sort_order: number;
  is_mandatory: boolean;
  requires_photo: boolean;
}

interface ChecklistItemsEditorProps {
  items: EditableChecklistItem[];
  defaultCategory: ChecklistCategory;
  onChange: (items: EditableChecklistItem[]) => void;
}

const inputClass =
  'w-full px-2 py-1.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

export function ChecklistItemsEditor({ items, defaultCategory, onChange }: ChecklistItemsEditorProps) {
  const addItem = () => {
    onChange([
      ...items,
      {
        item_text: '',
        category: defaultCategory,
        severity: 'medium',
        regulation_reference: '',
        sort_order: items.length,
        is_mandatory: true,
        requires_photo: false,
      },
    ]);
  };

  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  const updateItem = <K extends keyof EditableChecklistItem>(
    idx: number,
    field: K,
    value: EditableChecklistItem[K]
  ) => {
    onChange(items.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider">
          Checklist Items ({items.length})
        </h3>
        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-1 text-xs text-[var(--ff-primary-500)] hover:text-[var(--ff-primary-400)] min-h-[44px] px-2"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add Item
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-tertiary)] italic">
          No items yet. Click &quot;Add Item&quot; to start building this checklist.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-[var(--ff-bg-tertiary)] text-left text-xs text-[var(--ff-text-tertiary)] uppercase">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium w-32">Severity</th>
                <th className="px-3 py-2 font-medium w-40">Regulation Ref</th>
                <th className="px-3 py-2 font-medium w-24 text-center">Mandatory</th>
                <th className="px-3 py-2 font-medium w-24 text-center">Photo</th>
                <th className="px-3 py-2 font-medium w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {items.map((item, idx) => (
                <tr key={item.id ?? `new-${idx}`}>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={item.item_text}
                      onChange={(e) => updateItem(idx, 'item_text', e.target.value)}
                      placeholder="Checklist item text"
                      aria-label={`Item ${idx + 1} text`}
                      required
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={item.severity}
                      onChange={(e) => updateItem(idx, 'severity', e.target.value as ItemSeverity)}
                      aria-label={`Item ${idx + 1} severity`}
                      className={inputClass}
                    >
                      {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>
                          {cfg.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={item.regulation_reference}
                      onChange={(e) => updateItem(idx, 'regulation_reference', e.target.value)}
                      placeholder="e.g. Reg 8"
                      aria-label={`Item ${idx + 1} regulation reference`}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={item.is_mandatory}
                      onChange={(e) => updateItem(idx, 'is_mandatory', e.target.checked)}
                      aria-label={`Item ${idx + 1} is mandatory`}
                      className="w-4 h-4 rounded border-[var(--ff-border-light)] text-[var(--ff-primary-500)] focus:ring-[var(--ff-primary-500)]"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={item.requires_photo}
                      onChange={(e) => updateItem(idx, 'requires_photo', e.target.checked)}
                      aria-label={`Item ${idx + 1} requires photo`}
                      className="w-4 h-4 rounded border-[var(--ff-border-light)] text-[var(--ff-primary-500)] focus:ring-[var(--ff-primary-500)]"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      aria-label={`Remove item ${idx + 1}`}
                      onClick={() => removeItem(idx)}
                      className="p-2 text-red-400 hover:text-red-300 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
