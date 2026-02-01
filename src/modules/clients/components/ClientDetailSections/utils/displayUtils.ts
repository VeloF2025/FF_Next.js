export const getStatusColor = (status: string): string => {
  const statusLower = status?.toLowerCase() || '';
  switch (statusLower) {
    case 'active': return 'bg-green-500/20 text-green-400';
    case 'prospect': return 'bg-blue-500/20 text-blue-400';
    case 'inactive': return 'bg-gray-500/20 text-gray-400';
    case 'suspended': return 'bg-red-500/20 text-red-400';
    case 'former': return 'bg-orange-500/20 text-orange-400';
    default: return 'bg-gray-500/20 text-gray-400';
  }
};

export const getPriorityColor = (priority: string): string => {
  const priorityLower = priority?.toLowerCase() || '';
  switch (priorityLower) {
    case 'vip': return 'bg-purple-500/20 text-purple-400';
    case 'critical': return 'bg-red-500/20 text-red-400';
    case 'high': return 'bg-orange-500/20 text-orange-400';
    case 'medium': return 'bg-yellow-500/20 text-yellow-400';
    case 'low': return 'bg-gray-500/20 text-gray-400';
    default: return 'bg-gray-500/20 text-gray-400';
  }
};

export const getCreditRatingColor = (rating: string): string => {
  const ratingLower = rating?.toLowerCase() || '';
  switch (ratingLower) {
    case 'excellent': return 'text-green-400';
    case 'good': return 'text-blue-400';
    case 'fair': return 'text-yellow-400';
    case 'poor': return 'text-red-400';
    default: return 'text-gray-400';
  }
};

export const formatCurrency = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 'R 0';
  }
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatText = (text: string): string => {
  return text.replace('_', ' ').charAt(0).toUpperCase() + text.slice(1);
};

export const formatTextUppercase = (text: string): string => {
  return text.replace('_', ' ').toUpperCase();
};