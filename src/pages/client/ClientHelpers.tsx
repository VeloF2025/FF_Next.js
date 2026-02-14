/**
 * Client Detail Helper Functions
 */

export const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    'active': 'bg-green-100 text-green-800',
    'prospect': 'bg-blue-100 text-blue-800',
    'inactive': 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200',
    'suspended': 'bg-red-100 text-red-800',
    'former': 'bg-orange-100 text-orange-800'
  };
  return colors[status] || 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
};

export const getPriorityColor = (priority: string) => {
  const colors: Record<string, string> = {
    'vip': 'bg-purple-100 text-purple-800',
    'critical': 'bg-red-100 text-red-800',
    'high': 'bg-orange-100 text-orange-800',
    'medium': 'bg-yellow-100 text-yellow-800',
    'low': 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'
  };
  return colors[priority] || 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
};

export const getCreditRatingColor = (rating: string) => {
  const colors: Record<string, string> = {
    'excellent': 'text-green-600',
    'good': 'text-blue-600',
    'fair': 'text-yellow-600',
    'poor': 'text-red-600'
  };
  return colors[rating] || 'text-gray-600 dark:text-gray-400';
};

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};