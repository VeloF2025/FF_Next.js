export const getMeetingTypeColor = (type: string): string => {
  switch (type) {
    case 'team': return 'bg-blue-500/20 text-blue-400';
    case 'client': return 'bg-green-500/20 text-green-400';
    case 'board': return 'bg-purple-500/20 text-purple-400';
    case 'standup': return 'bg-yellow-500/20 text-yellow-400';
    case 'review': return 'bg-orange-500/20 text-orange-400';
    default: return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]';
  }
};

export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'scheduled': return 'bg-blue-500/20 text-blue-400';
    case 'in_progress': return 'bg-yellow-500/20 text-yellow-400';
    case 'completed': return 'bg-green-500/20 text-green-400';
    case 'cancelled': return 'bg-red-500/20 text-red-400';
    default: return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]';
  }
};