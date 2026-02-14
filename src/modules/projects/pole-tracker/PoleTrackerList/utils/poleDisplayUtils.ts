export const getStatusColor = (status: string): string => {
  if (status === 'completed') return 'ff-badge ff-badge-success';
  if (status === 'in_progress') return 'ff-badge ff-badge-warning';
  if (status === 'pending') return 'ff-badge ff-badge-info';
  if (status === 'issue') return 'ff-badge ff-badge-error';
  return 'ff-badge ff-badge-neutral';
};

export const getPhaseColor = (phase: string): string => {
  switch (phase) {
    case 'completion': return 'text-green-600';
    case 'testing': return 'text-blue-600';
    case 'installation': return 'text-purple-600';
    case 'excavation': return 'text-orange-600';
    case 'permission': return 'text-yellow-600';
    default: return 'text-muted-foreground';
  }
};

export const getStatusDisplayText = (status: string): string => {
  switch (status) {
    case 'completed': return 'Completed';
    case 'in_progress': return 'In Progress';
    case 'pending': return 'Pending';
    case 'issue': return 'Issue';
    default: return status;
  }
};

export const formatPhaseText = (phase: string): string => {
  return phase ? phase.charAt(0).toUpperCase() + phase.slice(1) : 'Permission';
};