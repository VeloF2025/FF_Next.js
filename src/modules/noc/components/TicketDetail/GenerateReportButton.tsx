/**
 * GenerateReportButton — opens the ticket's resolution report PDF in a new
 * tab. First run for a ticket triggers a VLM captioning pass (15–30s for
 * ~5 photos); cached runs return near-instantly.
 */

'use client';

import { useState } from 'react';
import { FileText, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GenerateReportButtonProps {
  ticketId: string;
  ticketUid: string;
  /** Render as a smaller icon-only button. Useful in the action panel header. */
  compact?: boolean;
  className?: string;
}

export function GenerateReportButton({
  ticketId,
  ticketUid,
  compact = false,
  className,
}: GenerateReportButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch(`/api/noc/tickets/${ticketId}/report`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!res.ok) {
        let msg = `Report generation failed (${res.status})`;
        try {
          const body = await res.json();
          msg = body?.error?.message || body?.error?.detail || msg;
        } catch {
          // ignore — use default message
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Open in a new tab so the user can print/download — also triggers a
      // filename hint via the Content-Disposition from the server.
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) {
        // Popup blocker fallback: force a download.
        const a = document.createElement('a');
        a.href = url;
        a.download = `ticket-report-${ticketUid}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Release the object URL after a short grace period so the new tab
      // can finish loading the PDF first.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isGenerating}
        className={cn(
          'flex items-center justify-center gap-2 rounded-lg border transition-colors',
          'bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]',
          'text-[var(--ff-text-primary)] disabled:opacity-60 disabled:cursor-not-allowed',
          compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm font-medium'
        )}
        title="Generate a professional PDF report of this ticket (uses AI to describe photos)"
        aria-label="Generate ticket report PDF"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Generating report…</span>
          </>
        ) : (
          <>
            <FileText className="w-4 h-4" />
            <span>{compact ? 'Report' : 'Generate Report'}</span>
          </>
        )}
      </button>
      {isGenerating && (
        <span className="text-[10px] text-[var(--ff-text-tertiary)] italic">
          First run captions each photo with AI — may take 15-30 seconds.
        </span>
      )}
      {error && (
        <div className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="w-3 h-3" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
