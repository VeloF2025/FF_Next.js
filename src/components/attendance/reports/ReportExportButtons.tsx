import { useState } from 'react';
import { Download, FileText } from 'lucide-react';

import { log } from '@/lib/logger';
import type { ReportDef } from '@/services/attendance/reports/types';
import { buildQuery, type ReportFormState } from './reportFormatters';

interface Props {
  def: ReportDef;
  form: ReportFormState;
  enabled: boolean;
  onError: (message: string) => void;
}

export function ReportExportButtons({ def, form, enabled, onError }: Props) {
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);

  const onExport = async (format: 'csv' | 'xlsx') => {
    setExporting(format);
    try {
      const query = buildQuery(def.slug, def, form);
      query.set('format', format);
      const response = await fetch(`/api/staff/attendance-report-export?${query.toString()}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const body = await response.text();
        let message = 'Export failed.';
        try {
          const parsed = JSON.parse(body) as { error?: { message?: string } };
          if (parsed.error?.message) message = parsed.error.message;
        } catch { /* keep generic */ }
        onError(message);
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = match?.[1] ?? `pulse-${def.slug}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(anchor.href);
    } catch (err) {
      log.error('PulseReport export failed', err instanceof Error ? { message: err.message } : { err });
      onError('Network error during export.');
    } finally {
      setExporting(null);
    }
  };

  const disabled = !enabled || exporting !== null;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onExport('xlsx')}
        disabled={disabled}
        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {exporting === 'xlsx' ? 'Exporting…' : 'XLSX'}
      </button>
      <button
        type="button"
        onClick={() => onExport('csv')}
        disabled={disabled}
        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-emerald-700 text-emerald-300 text-sm hover:bg-emerald-900/30 disabled:opacity-50"
      >
        <FileText className="h-4 w-4" />
        {exporting === 'csv' ? 'Exporting…' : 'CSV'}
      </button>
    </div>
  );
}
