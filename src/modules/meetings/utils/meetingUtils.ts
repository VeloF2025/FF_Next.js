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

export const getSourceColor = (source: string): string => {
  switch (source) {
    case 'teams': return 'bg-purple-500/20 text-purple-400';
    case 'fireflies': return 'bg-orange-500/20 text-orange-400';
    case 'livekit': return 'bg-green-500/20 text-green-400';
    case 'manual': return 'bg-gray-500/20 text-gray-400';
    default: return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]';
  }
};

export const getSourceLabel = (source: string): string => {
  switch (source) {
    case 'teams': return 'Teams';
    case 'fireflies': return 'Fireflies';
    case 'livekit': return 'LiveKit';
    case 'manual': return 'Manual';
    default: return source;
  }
};

export const getProcessingStatusLabel = (status: string): string => {
  switch (status) {
    case 'pending': return 'Pending';
    case 'fetching': return 'Fetching data...';
    case 'processing': return 'AI processing...';
    case 'completed': return 'Processed';
    case 'failed': return 'Failed';
    default: return status;
  }
};