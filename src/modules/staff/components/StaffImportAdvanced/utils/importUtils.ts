/**
 * Staff Import Utilities
 * Helper functions for file validation and processing
 */

export const validateImportFile = (file: File): { valid: boolean; error?: string } => {
  const allowedTypes = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  
  const isValidType = allowedTypes.includes(file.type) || 
                     file.name.endsWith('.csv') || 
                     file.name.endsWith('.xlsx') || 
                     file.name.endsWith('.xls');

  if (!isValidType) {
    return { valid: false, error: 'Please select a valid CSV or Excel file' };
  }

  return { valid: true };
};

export const getFileTypeFromFile = (file: File): 'csv' | 'excel' | 'unknown' => {
  if (file.name.endsWith('.csv') || file.type === 'text/csv') {
    return 'csv';
  }
  
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || 
      file.type.includes('spreadsheet') || file.type.includes('excel')) {
    return 'excel';
  }
  
  return 'unknown';
};

export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'parsing': return 'text-blue-600';
    case 'importing': return 'text-yellow-600';
    case 'completed': return 'text-green-600';
    case 'error': return 'text-red-600';
    default: return 'text-muted-foreground';
  }
};

export const getStatusText = (status: string): string => {
  switch (status) {
    case 'parsing': return 'Parsing file...';
    case 'importing': return 'Importing staff...';
    case 'completed': return 'Import completed';
    case 'error': return 'Import failed';
    default: return 'Ready to import';
  }
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};