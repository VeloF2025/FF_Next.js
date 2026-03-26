'use client';

import { X, Key, Link2, Type } from 'lucide-react';
import type { TableInfo, SchemaData } from '../types';

interface TablePanelProps {
  table: TableInfo;
  schema: SchemaData;
  onNavigate: (table: TableInfo) => void;
}

export function TablePanel({ table, schema, onNavigate }: TablePanelProps) {
  return (
    <div className="w-96 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden flex flex-col">
      {/* Header */}
      <div className="border-b border-[var(--ff-border-light)] p-4">
        <h2 className="text-lg font-bold text-[var(--ff-text-primary)]">{table.name}</h2>
        <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
          Module: <span className="font-semibold text-[var(--ff-text-secondary)]">{table.module}</span>
        </p>
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Type className="w-4 h-4" />
            Columns ({table.columns.length})
          </h3>

          <div className="space-y-2">
            {table.columns.map((col) => (
              <div
                key={col.name}
                className="bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded p-3 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--ff-text-primary)]">{col.name}</span>
                  {col.isPrimaryKey && <Key className="w-3 h-3 text-blue-600" title="Primary Key" />}
                  {col.isForeignKey && <Link2 className="w-3 h-3 text-green-600" title="Foreign Key" />}
                </div>
                <div className="text-[var(--ff-text-tertiary)] mt-1">
                  {col.dataType}
                  {col.nullable ? ', nullable' : ', NOT NULL'}
                </div>
                {col.defaultValue && (
                  <div className="text-[var(--ff-text-tertiary)] mt-1">
                    Default: <code className="bg-black/20 px-1 rounded">{col.defaultValue}</code>
                  </div>
                )}
                {col.foreignKeyReferences && (
                  <button
                    onClick={() => {
                      const refTable = schema.tables.find((t) => t.name === col.foreignKeyReferences?.table);
                      if (refTable) onNavigate(refTable);
                    }}
                    className="text-blue-600 hover:text-blue-700 font-semibold mt-2"
                  >
                    → {col.foreignKeyReferences.table}.{col.foreignKeyReferences.column}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--ff-border-light)] p-4 text-xs text-[var(--ff-text-tertiary)]">
        Primary Key: <span className="font-semibold">{table.primaryKey || 'None'}</span>
      </div>
    </div>
  );
}
