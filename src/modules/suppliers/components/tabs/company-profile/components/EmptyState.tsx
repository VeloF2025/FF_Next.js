// ============= Empty State Component =============
// Empty state for no suppliers found

import React from 'react';
import { Building2 } from 'lucide-react';

export const EmptyState: React.FC = () => {
  return (
    <div className="text-center py-12 bg-card rounded-lg border border-border">
      <Building2 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-2">No Suppliers Found</h3>
      <p className="text-muted-foreground">No suppliers match your current filters.</p>
    </div>
  );
};
