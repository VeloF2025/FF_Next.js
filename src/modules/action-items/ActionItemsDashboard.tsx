'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Clock, AlertCircle, Calendar, Users, Filter, Inbox } from 'lucide-react';
import { useRouter } from 'next/router';
import { ActionItemStats } from '@/types/action-items.types';
import { actionItemsService } from '@/services/action-items/actionItemsService';
import { log } from '@/lib/logger';

export function ActionItemsDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<ActionItemStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await actionItemsService.getStats();
        setStats(data);
      } catch (error) {
        log.error('Error fetching stats', { error }, 'ActionItemsDashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const cards = [
    {
      title: 'My Actions',
      description: 'Action items assigned to you across all modules',
      icon: Inbox,
      color: 'bg-[var(--ff-primary)]',
      onClick: () => router.push('/action-items/my-actions'),
    },
    {
      title: 'Pending Actions',
      description: 'View all pending action items',
      icon: Clock,
      color: 'bg-yellow-500',
      count: stats?.pending,
      onClick: () => router.push('/action-items/pending'),
    },
    {
      title: 'Completed Actions',
      description: 'Review completed action items',
      icon: CheckCircle,
      color: 'bg-green-500',
      count: stats?.completed,
      onClick: () => router.push('/action-items/completed'),
    },
    {
      title: 'Overdue Actions',
      description: 'Urgent overdue action items',
      icon: AlertCircle,
      color: 'bg-red-500',
      count: stats?.overdue,
      onClick: () => router.push('/action-items/overdue'),
    },
    {
      title: 'By Meeting',
      description: 'Actions grouped by meetings',
      icon: Calendar,
      color: 'bg-blue-500',
      onClick: () => router.push('/action-items/by-meeting'),
    },
    {
      title: 'By Assignee',
      description: 'Actions grouped by person',
      icon: Users,
      color: 'bg-purple-500',
      onClick: () => router.push('/action-items/by-assignee'),
    },
    {
      title: 'Filter & Search',
      description: 'Advanced filtering options',
      icon: Filter,
      color: 'bg-indigo-500',
      onClick: () => router.push('/action-items/search'),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Action Items</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">Track and manage action items from meetings, procurement, NOC, and more</p>
      </div>

      {/* Summary Stats */}
      {loading ? (
        <div className="text-center py-8">
          <p className="text-[var(--ff-text-secondary)]">Loading stats...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Total Actions</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats?.total || 0}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Pending</p>
                <p className="text-2xl font-bold text-yellow-400">{stats?.pending || 0}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500" />
            </div>
          </div>
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Overdue</p>
                <p className="text-2xl font-bold text-red-400">{stats?.overdue || 0}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
          </div>
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Completed</p>
                <p className="text-2xl font-bold text-green-400">{stats?.completed || 0}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </div>
        </div>
      )}

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card) => (
          <div
            key={card.title}
            onClick={card.onClick}
            className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start space-x-4">
              <div className={`${card.color} p-3 rounded-lg`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-1">
                  {card.title}
                  {card.count !== undefined && (
                    <span className="ml-2 text-sm font-normal text-[var(--ff-text-secondary)]">
                      ({card.count})
                    </span>
                  )}
                </h3>
                <p className="text-sm text-[var(--ff-text-secondary)]">{card.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}