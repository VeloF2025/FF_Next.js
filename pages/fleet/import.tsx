/**
 * Fleet Bulk Import Page
 * Upload Excel/CSV to import odometer readings or fuel transactions
 */

import { useState, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { fleetConfig } from '@/modules/navigation';
import { notificationService } from '@/services/core/NotificationService';
import { Upload, Download, FileSpreadsheet, Gauge, Fuel, CheckCircle2, AlertTriangle, X } from 'lucide-react';

type ImportType = 'odometer' | 'fuel';
interface ImportResult { imported: number; skipped: number; total: number; errors: { row: number; message: string }[] }

export default function FleetImportPage() {
  const [importType, setImportType] = useState<ImportType>('odometer');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.(xlsx|xls|csv)$/i)) {
      notificationService.error('Please upload an Excel (.xlsx) or CSV file');
      return;
    }
    setFile(f);
    setResult(null);

    // Parse preview client-side
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(evt.target?.result, { type: 'array', cellDates: true });
        const sn = wb.SheetNames[0];
        if (!sn) return;
        const sheet = wb.Sheets[sn];
        if (!sheet) return;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
        setPreview(rows.slice(0, 20));
      } catch {
        notificationService.error('Failed to parse file');
      }
    };
    reader.readAsArrayBuffer(f);
  }, []);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setResult(null);

    try {
      // Convert file to base64
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

      const res = await fetch(`/api/fleet/import/${importType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64, fileName: file.name }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Import failed');
      }

      const data = await res.json();
      setResult(data.data);
      notificationService.success(`Imported ${data.data.imported} records`);
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    window.open(`/api/fleet/import/template?type=${importType}`, '_blank');
  };

  return (
    <AppLayout>
      <ModulePage config={fleetConfig}>
        <div className="p-6 space-y-6 max-w-4xl">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <Upload className="w-7 h-7 text-[var(--ff-primary)]" />
              Bulk Import
            </h1>
            <p className="text-[var(--ff-text-secondary)]">Import odometer readings or fuel transactions from Excel/CSV</p>
          </div>

          {/* Import Type Selector */}
          <div className="grid grid-cols-2 gap-4">
            <TypeCard type="odometer" icon={Gauge} label="Odometer Readings"
              desc="Registration, Date, Reading (km)" active={importType === 'odometer'}
              onClick={() => { setImportType('odometer'); setFile(null); setPreview(null); setResult(null); }} />
            <TypeCard type="fuel" icon={Fuel} label="Fuel Transactions"
              desc="Registration, Date, Amount (R), Litres, Station" active={importType === 'fuel'}
              onClick={() => { setImportType('fuel'); setFile(null); setPreview(null); setResult(null); }} />
          </div>

          {/* Template Download + File Upload */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {importType === 'odometer' ? 'Odometer Import' : 'Fuel Transaction Import'}
              </h2>
              <button onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
                <Download className="w-4 h-4" /> Download Template
              </button>
            </div>

            {/* Drop zone */}
            <label className="block border-2 border-dashed border-[var(--ff-border-light)] rounded-lg p-8 text-center cursor-pointer hover:border-[var(--ff-primary)] transition-colors">
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} className="hidden" />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileSpreadsheet className="w-8 h-8 text-green-400" />
                  <div className="text-left">
                    <p className="font-medium text-[var(--ff-text-primary)]">{file.name}</p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">{(file.size / 1024).toFixed(1)} KB — {preview?.length || 0} rows previewed</p>
                  </div>
                  <button onClick={(e) => { e.preventDefault(); setFile(null); setPreview(null); setResult(null); }}
                    className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-400"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
                  <p className="text-[var(--ff-text-secondary)]">Drop your .xlsx or .csv file here, or click to browse</p>
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">Max 10MB</p>
                </>
              )}
            </label>

            {/* Preview Table */}
            {preview && preview.length > 0 && (
              <div className="overflow-x-auto">
                <p className="text-xs text-[var(--ff-text-secondary)] mb-2">Preview (first {preview.length} rows):</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--ff-border-light)]">
                      {Object.keys(preview[0] || {}).map(key => (
                        <th key={key} className="py-2 px-3 text-left text-xs text-[var(--ff-text-secondary)] font-medium">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-b border-[var(--ff-border-light)]">
                        {Object.values(row).map((val, j) => (
                          <td key={j} className="py-2 px-3 text-xs text-[var(--ff-text-primary)]">
                            {val instanceof Date ? val.toISOString().split('T')[0] : String(val ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Import Button */}
            {file && (
              <button onClick={handleImport} disabled={importing}
                className="w-full py-3 bg-[var(--ff-primary)] text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {importing ? (
                  <><span className="animate-spin">&#9696;</span> Importing...</>
                ) : (
                  <><Upload className="w-4 h-4" /> Import {preview?.length || 0} rows</>
                )}
              </button>
            )}
          </div>

          {/* Results */}
          {result && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 space-y-4">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Import Results</h3>
              <div className="grid grid-cols-3 gap-4">
                <ResultCard icon={CheckCircle2} label="Imported" value={result.imported} color="text-green-400" />
                <ResultCard icon={AlertTriangle} label="Skipped" value={result.skipped} color="text-yellow-400" />
                <ResultCard icon={FileSpreadsheet} label="Total Rows" value={result.total} color="text-[var(--ff-text-primary)]" />
              </div>
              {result.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-red-400 mb-2">Errors ({result.errors.length}):</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {result.errors.map((err, i) => (
                      <div key={i} className="text-xs text-[var(--ff-text-secondary)] bg-red-900/10 rounded px-3 py-1.5">
                        <span className="text-red-400 font-medium">Row {err.row}:</span> {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ModulePage>
    </AppLayout>
  );
}

function TypeCard({ type, icon: Icon, label, desc, active, onClick }: {
  type: string; icon: React.ElementType; label: string; desc: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`text-left p-4 rounded-lg border-2 transition-colors ${
        active ? 'border-[var(--ff-primary)] bg-[var(--ff-primary)]/10' : 'border-[var(--ff-border-light)] hover:border-[var(--ff-primary)]/50'
      }`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-5 h-5 ${active ? 'text-[var(--ff-primary)]' : 'text-[var(--ff-text-secondary)]'}`} />
        <span className={`font-medium ${active ? 'text-[var(--ff-primary)]' : 'text-[var(--ff-text-primary)]'}`}>{label}</span>
      </div>
      <p className="text-xs text-[var(--ff-text-tertiary)]">{desc}</p>
    </button>
  );
}

function ResultCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="bg-[var(--ff-bg-primary)] rounded-lg p-3 text-center">
      <Icon className={`w-5 h-5 mx-auto mb-1 ${color}`} />
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-[var(--ff-text-secondary)]">{label}</p>
    </div>
  );
}
