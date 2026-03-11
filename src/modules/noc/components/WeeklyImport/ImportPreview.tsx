/**
 * ImportPreview Component - Display parsed data preview with validation
 *
 * 🟢 WORKING: Production-ready import preview component
 *
 * Features:
 * - Display total, valid, and invalid row counts
 * - Show sample rows in table format
 * - List validation errors with row numbers
 * - Indicate whether import can proceed
 * - Responsive table design
 */

'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ImportPreviewResult, ImportRow, ImportValidationError } from '../../types/weeklyReport';

interface ImportPreviewProps {
  /** Preview data from parsing */
  preview: ImportPreviewResult;
}

/**
 * 🟢 WORKING: Display import preview with validation
 */
export function ImportPreview({ preview }: ImportPreviewProps) {
  return (
    <div className="space-y-6">
      {/* Summary Statistics */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Total Rows"
          value={preview.total_rows}
          icon={<AlertCircle className="w-5 h-5" />}
          color="blue"
        />
        <StatCard
          label="Valid Rows"
          value={preview.valid_rows}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="green"
        />
        <StatCard
          label="Invalid Rows"
          value={preview.invalid_rows}
          icon={<XCircle className="w-5 h-5" />}
          color="red"
        />
      </div>

      {/* Preview Title */}
      <div>
        <h3 className="text-base font-medium text-[var(--ff-text-primary)]">Preview Import Data</h3>
        <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
          Review the first few rows to ensure data is correctly formatted
        </p>
      </div>

      {/* Sample Rows Table - Maps Excel columns to FibreFlow schema */}
      {preview.sample_rows.length > 0 && (
        <div className="overflow-x-auto border border-[var(--ff-border-light)] rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Row
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Ticket UID
                  <span className="block text-[10px] font-normal normal-case text-[var(--ff-text-tertiary)]">FT Ref</span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  DR Number
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Project
                  <span className="block text-[10px] font-normal normal-case text-[var(--ff-text-tertiary)]">Area</span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Title
                  <span className="block text-[10px] font-normal normal-case text-[var(--ff-text-tertiary)]">Issue</span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {preview.sample_rows.map((row) => (
                <SampleRow key={row.row_number} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Validation Errors */}
      {preview.validation_errors.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-base font-medium text-[var(--ff-text-primary)]">
              Validation Issues ({preview.validation_errors.length})
            </h3>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {preview.validation_errors.map((error, index) => (
              <ValidationErrorItem key={index} error={error} />
            ))}
          </div>
        </div>
      )}

      {/* Can Proceed Indicator */}
      <div
        className={cn(
          'p-4 border rounded-lg',
          preview.can_proceed
            ? 'bg-green-500/10 border-green-500/20'
            : 'bg-red-500/10 border-red-500/20'
        )}
      >
        <div className="flex items-start gap-3">
          {preview.can_proceed ? (
            <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <div>
            <p className={cn('text-sm font-medium', preview.can_proceed ? 'text-green-200' : 'text-red-200')}>
              {preview.can_proceed
                ? 'Ready to import'
                : 'Cannot proceed with import'}
            </p>
            <p className={cn('text-xs mt-1', preview.can_proceed ? 'text-green-300/80' : 'text-red-300/80')}>
              {preview.can_proceed
                ? `${preview.valid_rows} valid rows will be imported`
                : 'Please fix all errors before importing'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Statistic card component
 */
function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'red';
}) {
  const colorClasses = {
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
  };

  return (
    <div className={cn('p-4 border rounded-lg', colorClasses[color])}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">{label}</p>
          <p className="text-2xl font-semibold mt-1">{value}</p>
        </div>
        <div className="opacity-50">{icon}</div>
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Sample row component for maintenance ticket preview
 * Maps Excel columns to FibreFlow schema:
 * - FT Ref → ticket_uid
 * - DR Number → dr_number
 * - Area → project (lookup by name)
 * - Issue → title
 * - Status → status
 */
function SampleRow({ row }: { row: ImportRow }) {
  // Access maintenance-specific fields from the dynamic row data
  const rowData = row as unknown as Record<string, unknown>;

  return (
    <tr className="hover:bg-[var(--ff-bg-tertiary)] transition-colors">
      <td className="px-4 py-3 text-[var(--ff-text-tertiary)] font-mono text-xs">{row.row_number}</td>
      <td className="px-4 py-3 text-[var(--ff-text-secondary)] font-mono text-xs">{String(rowData.ft_ref || '-')}</td>
      <td className="px-4 py-3 text-[var(--ff-text-secondary)] font-mono text-xs">{row.dr_number || '-'}</td>
      <td className="px-4 py-3 text-[var(--ff-text-primary)]">{String(rowData.area || '-')}</td>
      <td className="px-4 py-3 text-[var(--ff-text-secondary)] max-w-xs truncate">{String(rowData.issue || '-')}</td>
      <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
        <span className="px-2 py-1 bg-[var(--ff-bg-tertiary)] rounded text-xs">
          {String(rowData.status || '-')}
        </span>
      </td>
    </tr>
  );
}

/**
 * 🟢 WORKING: Validation error item component
 */
function ValidationErrorItem({ error }: { error: ImportValidationError }) {
  const isError = error.severity === 'error';

  return (
    <div
      className={cn(
        'p-3 border rounded-lg',
        isError ? 'bg-red-500/10 border-red-500/20' : 'bg-yellow-500/10 border-yellow-500/20'
      )}
    >
      <div className="flex items-start gap-3">
        {isError ? (
          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-medium', isError ? 'text-red-300' : 'text-yellow-300')}>
              Row {error.row_number}
            </span>
            {error.field_name && (
              <span className="text-xs text-[var(--ff-text-tertiary)]">
                • {error.field_name}
              </span>
            )}
          </div>
          <p className={cn('text-sm mt-1', isError ? 'text-red-200' : 'text-yellow-200')}>
            {error.message}
          </p>
        </div>
      </div>
    </div>
  );
}
