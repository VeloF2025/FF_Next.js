'use client';

import { useRouter } from 'next/navigation';
import { Plus, Upload, Download } from 'lucide-react';
import { PermissionGate } from '@/components/PermissionGate';
import type { PermissionAction } from '@/hooks/usePermission';

interface StandardModuleHeaderProps {
  title: string;
  description: string;
  onImport?: () => void;
  onExport?: () => void;
  onAdd?: () => void;
  addButtonText?: string;
  addButtonPath?: string;
  itemCount?: number;
  showImport?: boolean;
  showExport?: boolean;
  showAdd?: boolean;
  exportDisabled?: boolean;
  /** Permission key for add/create button (e.g., 'procurement.sourcing.boq') */
  addPermission?: string;
  /** Permission action for add button (default: 'create') */
  addPermissionAction?: PermissionAction;
  /** Permission key for import button */
  importPermission?: string;
}

export function StandardModuleHeader({
  title,
  description,
  onImport,
  onExport,
  onAdd,
  addButtonText = 'Add Item',
  addButtonPath,
  itemCount = 0,
  showImport = true,
  showExport = true,
  showAdd = true,
  exportDisabled = false,
  addPermission,
  addPermissionAction = 'create',
  importPermission
}: StandardModuleHeaderProps) {
  const router = useRouter();

  const handleAdd = () => {
    if (onAdd) {
      onAdd();
    } else if (addButtonPath) {
      router.push(addButtonPath);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">{title}</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">{description}</p>
      </div>
      <div className="flex gap-3">
        {showImport && onImport && (
          importPermission ? (
            <PermissionGate permission={importPermission} action="create">
              <button
                onClick={onImport}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
              >
                <Upload className="h-4 w-4 mr-2" />
                Import
              </button>
            </PermissionGate>
          ) : (
            <button
              onClick={onImport}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import
            </button>
          )
        )}
        {showExport && onExport && (
          <button
            onClick={onExport}
            disabled={exportDisabled || itemCount === 0}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </button>
        )}
        {showAdd && (
          addPermission ? (
            <PermissionGate permission={addPermission} action={addPermissionAction}>
              <button
                onClick={handleAdd}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4 mr-2" />
                {addButtonText}
              </button>
            </PermissionGate>
          ) : (
            <button
              onClick={handleAdd}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4 mr-2" />
              {addButtonText}
            </button>
          )
        )}
      </div>
    </div>
  );
}