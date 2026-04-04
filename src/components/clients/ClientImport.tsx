import React, { useState } from 'react';
import { Building2 } from 'lucide-react';
import { log } from '@/lib/logger';
import { notificationService } from '@/services/core/NotificationService';
import { clientService } from '@/services/clientService';
import { ClientImportResult } from '@/types/client.types';
import {
  ClientImportProps,
  ClientFileDropZone,
  ClientFilePreview,
  ClientImportResults,
  ClientImportInstructions,
  ClientImportActions
} from './import';

export function ClientImport({ onComplete }: ClientImportProps = {}) {
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ClientImportResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFile = (file: File) => {
    setSelectedFile(file);
    setImportResult(null);
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    
    setIsImporting(true);
    try {
      let result: ClientImportResult;
      
      if (selectedFile.type === 'text/csv') {
        result = await clientService.import.importFromCSV(selectedFile);
      } else {
        result = await clientService.import.importFromExcel(selectedFile);
      }
      
      setImportResult(result);
      
      if (result.success && onComplete) {
        onComplete();
      }
    } catch (error) {
      log.error('Import error:', { data: error }, 'ClientImport');
      setImportResult({
        success: false,
        imported: 0,
        failed: 1,
        errors: [{
          row: 0,
          field: 'general',
          message: 'Failed to import file. Please check the format and try again.'
        }],
        clients: []
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const blob = clientService.import.getImportTemplate();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'client_import_template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportAll = async () => {
    try {
      const blob = await clientService.export.exportToExcel();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clients_export_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notificationService.success('Client data exported');
    } catch (error) {
      log.error('Export error:', { data: error }, 'ClientImport');
      notificationService.error('Failed to export client data');
    }
  };

  const resetImport = () => {
    setSelectedFile(null);
    setImportResult(null);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
        <div className="p-6 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="h-6 w-6 text-blue-600" />
              <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Import Clients</h2>
            </div>
            <ClientImportActions
              onDownloadTemplate={handleDownloadTemplate}
              onExportAll={handleExportAll}
            />
          </div>
        </div>

        <div className="p-6">
          {!selectedFile && !importResult && (
            <ClientFileDropZone
              onFileSelect={handleFile}
              dragActive={dragActive}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            />
          )}

          {selectedFile && !importResult && (
            <ClientFilePreview
              file={selectedFile}
              isImporting={isImporting}
              onImport={handleImport}
              onCancel={resetImport}
            />
          )}

          {importResult && (
            <ClientImportResults
              result={importResult}
              onReset={resetImport}
            />
          )}

          {!importResult && (
            <ClientImportInstructions />
          )}
        </div>
      </div>
    </div>
  );
}