'use client';

import { BarChart3 } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DailyProgress } from '../types/analytics.types';

interface DailyProgressChartProps {
  dailyProgress: DailyProgress[];
  isLoading: boolean;
}

export function DailyProgressChart({ dailyProgress, isLoading }: DailyProgressChartProps) {
  return (
    <div className="ff-card">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Daily Progress</h3>
          <BarChart3 className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
        </div>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <LoadingSpinner size="lg" label="" />
          </div>
        ) : (
          <div className="space-y-4">
            {dailyProgress.map((day, index) => (
              <div key={index}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-[var(--ff-text-primary)]">{day.date}</span>
                  <span className="text-sm text-[var(--ff-text-secondary)]">
                    {day.polesInstalled} poles, {day.dropsCompleted} drops
                  </span>
                </div>
                <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${(day.polesInstalled / 70) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}