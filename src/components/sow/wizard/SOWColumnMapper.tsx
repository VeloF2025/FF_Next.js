import { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

interface SOWColumnMapperProps {
  file: File;
  onMapped: (mappedFile: File) => void;
  onError: (error: string) => void;
}

interface ColumnMapping {
  from: string;
  to: string;
}

export function SOWColumnMapper({ file, onMapped, onError }: SOWColumnMapperProps) {
  const [isMapping, setIsMapping] = useState(false);
  const [mappingResult, setMappingResult] = useState<{
    originalColumns: string[];
    mappedColumns: string[];
    mappingsApplied: ColumnMapping[];
    mappedFile?: File;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mapColumns = async () => {
      if (!file) return;

      setIsMapping(true);
      setError(null);

      try {
        // Create FormData for the column mapping service
        const formData = new FormData();
        formData.append('file', file);
        formData.append('config_name', 'pole'); // Use pole config

        log.debug('Calling column mapping service', {}, 'SOWColumnMapper');

        // Call the column mapping service
        const response = await fetch('/api/sow/map-columns', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        // Get the mapped file
        const mappedBlob = await response.blob();

        // Create a new File object with the mapped content
        const mappedFile = new File([mappedBlob], file.name.replace('.xlsx', '_mapped.xlsx'), {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        // Also get preview data to show what was mapped
        const previewFormData = new FormData();
        previewFormData.append('file', file);
        previewFormData.append('config_name', 'pole');

        const previewResponse = await fetch('/api/sow/preview-columns', {
          method: 'POST',
          body: previewFormData,
        });

        if (previewResponse.ok) {
          const previewData = await previewResponse.json();
          setMappingResult({
            originalColumns: previewData.original_columns || [],
            mappedColumns: previewData.mapped_columns || [],
            mappingsApplied: previewData.mappings_applied || [],
            mappedFile
          });
        } else {
          // If preview fails, still provide the mapped file
          setMappingResult({
            originalColumns: [],
            mappedColumns: [],
            mappingsApplied: [],
            mappedFile
          });
        }

        // Pass the mapped file to the parent component
        onMapped(mappedFile);

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
        log.error('Column mapping failed', { error: err }, 'SOWColumnMapper');
        setError(errorMessage);
        onError(errorMessage);
      } finally {
        setIsMapping(false);
      }
    };

    mapColumns();
  }, [file, onMapped, onError]);

  if (isMapping) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">Mapping Columns</h3>
        <p className="text-[var(--ff-text-secondary)] text-center">
          Automatically mapping column names to match database requirements...
        </p>
        <div className="mt-4 text-sm text-[var(--ff-text-tertiary)]">
          File: {file.name}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <AlertCircle className="h-8 w-8 text-red-600 mb-4" />
        <h3 className="text-lg font-medium text-red-900 mb-2">Mapping Failed</h3>
        <p className="text-red-600 text-center max-w-md">
          {error}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (mappingResult) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <CheckCircle className="h-8 w-8 text-green-600 mb-4" />
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">Columns Mapped Successfully</h3>
        <p className="text-[var(--ff-text-secondary)] text-center mb-4">
          Column names have been standardized for database import
        </p>

        {mappingResult.mappingsApplied.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 max-w-md">
            <h4 className="text-sm font-medium text-green-800 mb-2">Applied Mappings:</h4>
            <ul className="text-sm text-green-700 space-y-1">
              {mappingResult.mappingsApplied.map((mapping, index) => (
                <li key={index}>
                  <code className="bg-green-100 px-1 rounded">{mapping.from}</code> →{' '}
                  <code className="bg-green-100 px-1 rounded">{mapping.to}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="text-sm text-[var(--ff-text-tertiary)]">
          Ready to proceed with import
        </div>
      </div>
    );
  }

  return null;
}