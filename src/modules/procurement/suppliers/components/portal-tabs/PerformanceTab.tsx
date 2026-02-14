import React from 'react';
import { CheckCircle, Award, Upload } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import type { Supplier } from '@/types/supplier/base.types';
import type { SupplierStats } from '../../types/portal.types';

export interface PerformanceTabProps {
  supplier: Supplier | null;
  stats: SupplierStats | null;
}

export const PerformanceTab: React.FC<PerformanceTabProps> = ({ supplier, stats }) => {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-foreground">Performance Analytics</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <GlassCard>
          <h3 className="text-lg font-semibold text-foreground mb-4">Overall Score</h3>
          <div className="text-center">
            <div className="text-4xl font-bold text-blue-600 mb-2">{stats?.averageScore || 0}/5</div>
            <div className="text-sm text-muted-foreground">Based on {supplier?.rating && typeof supplier.rating === 'object' ? supplier.rating.totalReviews : 0} reviews</div>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Delivery</span>
                <span>4.5/5</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Quality</span>
                <span>4.2/5</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Communication</span>
                <span>4.0/5</span>
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className="text-lg font-semibold text-foreground mb-4">Win Rate</h3>
          <div className="text-center">
            <div className="text-4xl font-bold text-green-600 mb-2">{stats?.winRate || 0}%</div>
            <div className="text-sm text-muted-foreground">Last 12 months</div>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Total Bids</span>
                <span>34</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Won</span>
                <span>23</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Average Value</span>
                <span>R125k</span>
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className="text-lg font-semibold text-foreground mb-4">Recent Activity</h3>
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <div className="text-sm">
                <div className="font-medium">Quote Submitted</div>
                <div className="text-muted-foreground">RFQ-2024-003 • 2 days ago</div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Award className="h-4 w-4 text-blue-500" />
              <div className="text-sm">
                <div className="font-medium">Contract Awarded</div>
                <div className="text-muted-foreground">RFQ-2024-001 • 1 week ago</div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm">
                <div className="font-medium">Document Updated</div>
                <div className="text-muted-foreground">Tax Certificate • 2 weeks ago</div>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
