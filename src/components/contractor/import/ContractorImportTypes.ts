/**
 * Contractor Import Component Types and Interfaces
 */

export interface ContractorImportResult {
  success: boolean;
  message: string;
  importedCount?: number;
  errorCount?: number;
  errors?: string[];
}

export interface ContractorImportProps {
  onComplete?: () => void;
}

export interface ContractorFileDropZoneProps {
  onFileSelect: (file: File) => void;
  dragActive: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export interface ContractorFilePreviewProps {
  file: File;
  isImporting: boolean;
  onImport: () => void;
  onCancel: () => void;
}

export interface ContractorImportResultsProps {
  result: ContractorImportResult;
  onReset: () => void;
}

export interface ContractorImportActionsProps {
  onDownloadTemplate: () => void;
  onExportAll: () => void;
}

export interface ContractorImportInstructionsProps {
  // No props needed for static content
}