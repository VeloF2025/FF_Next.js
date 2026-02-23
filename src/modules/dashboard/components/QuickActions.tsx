'use client';

import { useRouter } from 'next/router';
import {
  FolderPlus,
  UserPlus,
  FileText,
  Calendar,
  AlertCircle,
  MapPin,
  Package,
  BarChart3,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/auth.types';
import { cn } from '@/utils/cn';

interface QuickActionItem {
  id: string;
  title: string;
  description: string;
  icon: any;
  route: string;
  requiredPermissions: Permission[];
  iconColor: string;
}

interface QuickActionsProps {
  className?: string;
}

const quickActions: QuickActionItem[] = [
  {
    id: 'create-project',
    title: 'New Project',
    description: 'Start a new fibre project',
    icon: FolderPlus,
    route: '/projects/new',
    requiredPermissions: [Permission.PROJECTS_CREATE],
    iconColor: 'text-blue-400 bg-blue-500/20',
  },
  {
    id: 'add-staff',
    title: 'Add Staff',
    description: 'Register team member',
    icon: UserPlus,
    route: '/staff/new',
    requiredPermissions: [Permission.STAFF_CREATE],
    iconColor: 'text-green-400 bg-green-500/20',
  },
  {
    id: 'create-sow',
    title: 'Upload SOW',
    description: 'Import work document',
    icon: FileText,
    route: '/sow/import',
    requiredPermissions: [Permission.MANAGE_SOW],
    iconColor: 'text-purple-400 bg-purple-500/20',
  },
  {
    id: 'schedule-meeting',
    title: 'Schedule Meeting',
    description: 'Plan a meeting',
    icon: Calendar,
    route: '/meetings',
    requiredPermissions: [Permission.CREATE_COMMUNICATIONS],
    iconColor: 'text-cyan-400 bg-cyan-500/20',
  },
  {
    id: 'report-issue',
    title: 'Report Issue',
    description: 'Log a concern',
    icon: AlertCircle,
    route: '/action-items',
    requiredPermissions: [Permission.CREATE_COMMUNICATIONS],
    iconColor: 'text-orange-400 bg-orange-500/20',
  },
  {
    id: 'track-poles',
    title: 'Pole Tracker',
    description: 'Track installations',
    icon: MapPin,
    route: '/pole-tracker',
    requiredPermissions: [Permission.PROJECTS_READ],
    iconColor: 'text-pink-400 bg-pink-500/20',
  },
  {
    id: 'manage-inventory',
    title: 'Inventory',
    description: 'Check stock levels',
    icon: Package,
    route: '/procurement',
    requiredPermissions: [Permission.VIEW_PROCUREMENT],
    iconColor: 'text-amber-400 bg-amber-500/20',
  },
  {
    id: 'view-analytics',
    title: 'Analytics',
    description: 'View metrics',
    icon: BarChart3,
    route: '/analytics',
    requiredPermissions: [Permission.ANALYTICS_READ],
    iconColor: 'text-indigo-400 bg-indigo-500/20',
  },
];

export function QuickActions({ className = '' }: QuickActionsProps) {
  const router = useRouter();
  const { hasPermission } = useAuth();

  // Filter actions based on user permissions
  const availableActions = quickActions.filter(action =>
    action.requiredPermissions.length === 0 ||
    action.requiredPermissions.some(permission => hasPermission(permission))
  );

  const handleActionClick = (action: QuickActionItem) => {
    router.push(action.route);
  };

  return (
    <div className={cn(
      'bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6',
      className
    )}>
      {/* Header */}
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
        Quick Actions
      </h3>

      {/* Actions Grid - 4 columns on large screens */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {availableActions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.id}
              onClick={() => handleActionClick(action)}
              className={cn(
                'group relative p-4 rounded-lg border border-[var(--ff-border-light)]',
                'bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)]',
                'transition-all duration-200 text-center',
                'hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10'
              )}
            >
              {/* Icon */}
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3',
                'transition-transform duration-200 group-hover:scale-110',
                action.iconColor
              )}>
                <Icon className="w-6 h-6" />
              </div>

              {/* Title */}
              <h4 className="font-medium text-sm text-[var(--ff-text-primary)] mb-1">
                {action.title}
              </h4>

              {/* Description */}
              <p className="text-xs text-[var(--ff-text-secondary)] line-clamp-1">
                {action.description}
              </p>

              {/* Hover indicator */}
              <ChevronRight className={cn(
                'absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4',
                'text-[var(--ff-text-secondary)] opacity-0 -translate-x-2',
                'transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0'
              )} />
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {availableActions.length === 0 && (
        <div className="text-center py-8">
          <p className="text-[var(--ff-text-secondary)]">No quick actions available</p>
          <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
            Contact your administrator for access
          </p>
        </div>
      )}
    </div>
  );
}
