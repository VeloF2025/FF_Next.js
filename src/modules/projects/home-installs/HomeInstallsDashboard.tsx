'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';
import {
  Home,
  Calendar,
  Users,
  CheckCircle,
  AlertTriangle,
  Clock,
  MapPin,
  Package,
  TrendingUp,
  FileText,
  Camera,
  Wifi
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface InstallStats {
  totalScheduled: number;
  completedToday: number;
  pendingInstalls: number;
  activeTeams: number;
  averageTime: string;
  successRate: number;
}

export function HomeInstallsDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<InstallStats>({
    totalScheduled: 0,
    completedToday: 0,
    pendingInstalls: 0,
    activeTeams: 0,
    averageTime: '0h',
    successRate: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      // Load from service when available
      setStats({
        totalScheduled: 45,
        completedToday: 12,
        pendingInstalls: 33,
        activeTeams: 6,
        averageTime: '2.5h',
        successRate: 96.5
      });
    } catch (error) {
      log.error('Error loading install stats:', { data: error }, 'HomeInstallsDashboard');
    } finally {
      setLoading(false);
    }
  };

  const statsCards = [
    {
      label: 'Total Scheduled',
      value: stats.totalScheduled,
      icon: Calendar,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50'
    },
    {
      label: 'Completed Today',
      value: stats.completedToday,
      icon: CheckCircle,
      color: 'text-green-600',
      bgColor: 'bg-green-50'
    },
    {
      label: 'Pending Installs',
      value: stats.pendingInstalls,
      icon: Clock,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50'
    },
    {
      label: 'Active Teams',
      value: stats.activeTeams,
      icon: Users,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50'
    }
  ];

  const navigationCards = [
    {
      title: 'Schedule Install',
      description: 'Schedule new home installations',
      icon: Calendar,
      color: 'bg-blue-500',
      path: '/home-installs/schedule'
    },
    {
      title: 'Installation List',
      description: 'View and manage all installations',
      icon: Home,
      color: 'bg-green-500',
      path: '/home-installs/list'
    },
    {
      title: 'Team Management',
      description: 'Assign teams to installations',
      icon: Users,
      color: 'bg-purple-500',
      path: '/home-installs/teams'
    },
    {
      title: 'Installation Map',
      description: 'View installations on map',
      icon: MapPin,
      color: 'bg-red-500',
      path: '/home-installs/map'
    },
    {
      title: 'Equipment Tracking',
      description: 'Track ONT and router installations',
      icon: Package,
      color: 'bg-indigo-500',
      path: '/home-installs/equipment'
    },
    {
      title: 'Quality Checks',
      description: 'QC forms and validation',
      icon: CheckCircle,
      color: 'bg-teal-500',
      path: '/home-installs/qc'
    },
    {
      title: 'Photo Evidence',
      description: 'Installation photo management',
      icon: Camera,
      color: 'bg-orange-500',
      path: '/home-installs/photos'
    },
    {
      title: 'Connection Tests',
      description: 'Speed and connectivity tests',
      icon: Wifi,
      color: 'bg-cyan-500',
      path: '/home-installs/tests'
    },
    {
      title: 'Reports',
      description: 'Installation reports and analytics',
      icon: FileText,
      color: 'bg-gray-600',
      path: '/home-installs/reports'
    }
  ];

  const performanceMetrics = [
    { label: 'Average Install Time', value: stats.averageTime, icon: Clock },
    { label: 'Success Rate', value: `${stats.successRate}%`, icon: TrendingUp },
    { label: 'Issues Reported', value: '3', icon: AlertTriangle }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--ff-text-primary)] mb-2">Home Installations</h1>
        <p className="text-[var(--ff-text-secondary)]">Manage and track home fiber installations</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statsCards.map((stat, index) => (
          <div key={index} className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <span className="text-3xl font-bold text-[var(--ff-text-primary)]">{stat.value}</span>
            </div>
            <p className="text-sm text-[var(--ff-text-secondary)]">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Performance Metrics */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 mb-8">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Performance Metrics</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {performanceMetrics.map((metric, index) => (
            <div key={index} className="flex items-center space-x-3">
              <metric.icon className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">{metric.label}</p>
                <p className="text-xl font-semibold text-[var(--ff-text-primary)]">{metric.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {navigationCards.map((card, index) => (
          <button
            key={index}
            onClick={() => router.push(card.path)}
            className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md transition-shadow text-left"
          >
            <div className="flex items-start space-x-4">
              <div className={`p-3 rounded-lg ${card.color} bg-opacity-10`}>
                <card.icon className={`w-6 h-6 text-white ${card.color}`} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-1">{card.title}</h3>
                <p className="text-sm text-[var(--ff-text-secondary)]">{card.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="mt-8 bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Recent Installations</h2>
        <div className="space-y-3">
          {[
            { address: '123 Main St', status: 'completed', team: 'Team A', time: '2 hours ago' },
            { address: '456 Oak Ave', status: 'in_progress', team: 'Team B', time: '30 minutes ago' },
            { address: '789 Pine Rd', status: 'scheduled', team: 'Team C', time: 'In 1 hour' }
          ].map((install, index) => (
            <div key={index} className="flex items-center justify-between py-3 border-b border-[var(--ff-border-light)] last:border-0">
              <div className="flex items-center space-x-3">
                <Home className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">{install.address}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{install.team} • {install.time}</p>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                install.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                install.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
                'bg-gray-500/20 text-gray-400'
              }`}>
                {install.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}