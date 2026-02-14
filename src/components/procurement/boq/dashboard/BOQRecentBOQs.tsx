/**
 * BOQ Recent BOQs Component
 */

import { FileText, ArrowRight } from 'lucide-react';
import { BOQ, BOQStatusType } from '@/types/procurement/boq.types';

interface BOQRecentBOQsProps {
  recentBOQs: BOQ[];
  onViewAll: () => void;
  onSelectBOQ: (boq: BOQ) => void;
  formatRelativeTime: (date: Date) => string;
  getStatusColor: (status: BOQStatusType) => string;
}

export default function BOQRecentBOQs({
  recentBOQs,
  onViewAll,
  onSelectBOQ,
  formatRelativeTime,
  getStatusColor
}: BOQRecentBOQsProps) {
  return (
    <div className="bg-card rounded-lg border">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-foreground">Recent BOQs</h3>
          <button
            onClick={onViewAll}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
          >
            View all
            <ArrowRight className="h-3 w-3 ml-1" />
          </button>
        </div>
      </div>
      <div className="divide-y divide-gray-200">
        {recentBOQs.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            <FileText className="mx-auto h-8 w-8 text-gray-300 mb-2" />
            <p>No BOQs yet</p>
          </div>
        ) : (
          recentBOQs.map((boq) => (
            <div
              key={boq.id}
              className="p-4 hover:bg-background cursor-pointer"
              onClick={() => onSelectBOQ(boq)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <FileText className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="font-medium text-foreground">{boq.version}</p>
                    <p className="text-sm text-muted-foreground">{boq.fileName}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(boq.status)}`}>
                    {boq.status.replace('_', ' ')}
                  </span>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatRelativeTime(boq.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}