/**
 * Activity Header Component
 * Header section for the activity feed
 */

import { Clock, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ActivityHeaderProps {
  showAll: boolean;
  hasMore: boolean;
  onViewAll?: () => void;
}

export function ActivityHeader({ showAll, hasMore, onViewAll }: ActivityHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center space-x-2">
        <Clock className="w-5 h-5 text-primary-600" />
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          Recent Activity
        </h3>
      </div>
      
      {!showAll && hasMore && onViewAll && (
        <Button variant="link" onClick={onViewAll} className="text-sm flex items-center space-x-1">
          <span>View All</span>
          <ArrowRight className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}