'use client';

import { Database, Columns3, Link2, LucideIcon, AlertCircle } from 'lucide-react';
import type { SchemaStats } from '../types';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  color: string;
}

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-sm text-[var(--ff-text-secondary)]">{label}</p>
        <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{value}</p>
      </div>
    </div>
  );
}

interface StatsBarProps {
  stats: SchemaStats;
}

export function StatsBar({ stats }: StatsBarProps) {
  return (
    <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] px-6 py-4">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard icon={Database} label="Total Tables" value={stats.totalTables} color="bg-blue-600" />
        <StatCard icon={Columns3} label="Total Columns" value={stats.totalColumns} color="bg-green-600" />
        <StatCard icon={Link2} label="FK Relationships" value={stats.totalForeignKeys} color="bg-purple-600" />
        <StatCard icon={AlertCircle} label="Isolated Tables" value={stats.isolatedTables} color="bg-amber-600" />
      </div>
    </div>
  );
}
