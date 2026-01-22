// ============= Document Helper Functions =============
// Utility functions for document formatting and calculations

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

export const formatDate = (dateString: string): string => {
  return new Date(dateString).toISOString().split('T')[0];
};

export const getDaysUntilExpiry = (expiryDate: string | undefined): number | null => {
  if (!expiryDate) return null;
  const today = new Date();
  const expiry = new Date(expiryDate);
  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

export const getExpiryClassName = (daysUntilExpiry: number | null): string => {
  if (daysUntilExpiry === null) return '';
  if (daysUntilExpiry < 30) return 'text-red-600 font-medium';
  if (daysUntilExpiry < 90) return 'text-yellow-600 font-medium';
  return '';
};
