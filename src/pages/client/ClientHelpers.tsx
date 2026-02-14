/**
 * Client Detail Helper Functions
 */

export const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    'active': 'bg-green-100 text-green-800',
    'prospect': 'bg-blue-100 text-blue-800',
    'inactive': 'bg-secondary text-foreground',
    'suspended': 'bg-red-100 text-red-800',
    'former': 'bg-orange-100 text-orange-800'
  };
  return colors[status] || 'bg-secondary text-foreground';
};

export const getPriorityColor = (priority: string) => {
  const colors: Record<string, string> = {
    'vip': 'bg-purple-100 text-purple-800',
    'critical': 'bg-red-100 text-red-800',
    'high': 'bg-orange-100 text-orange-800',
    'medium': 'bg-yellow-100 text-yellow-800',
    'low': 'bg-secondary text-foreground'
  };
  return colors[priority] || 'bg-secondary text-foreground';
};

export const getCreditRatingColor = (rating: string) => {
  const colors: Record<string, string> = {
    'excellent': 'text-green-600',
    'good': 'text-blue-600',
    'fair': 'text-yellow-600',
    'poor': 'text-red-600'
  };
  return colors[rating] || 'text-muted-foreground';
};

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};