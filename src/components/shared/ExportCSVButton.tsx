/**
 * Reusable CSV export button.
 * Builds a URL from endpoint + filter params and opens it in a new tab.
 */
import { Download } from 'lucide-react';

interface ExportCSVButtonProps {
  endpoint: string;
  params?: Record<string, string | undefined>;
  filenamePrefix: string;
  disabled?: boolean;
  label?: string;
}

export function ExportCSVButton({
  endpoint,
  params,
  disabled,
  label = 'Export CSV',
}: ExportCSVButtonProps) {
  const handleExport = () => {
    const url = new URL(endpoint, window.location.origin);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '' && value !== 'all') {
          url.searchParams.set(key, value);
        }
      }
    }
    window.open(url.toString(), '_blank');
  };

  return (
    <button
      onClick={handleExport}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-secondary)] text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download className="h-4 w-4" />
      {label}
    </button>
  );
}
