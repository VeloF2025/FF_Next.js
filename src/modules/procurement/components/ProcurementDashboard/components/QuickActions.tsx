/**
 * Quick Actions Component
 * Action buttons for common procurement tasks
 */

import Link from 'next/link';
import { QuickAction } from '../types/dashboard.types';

interface QuickActionsProps {
  actions: QuickAction[];
}

export function QuickActions({ actions }: QuickActionsProps) {
  return (
    <div className="flex space-x-3">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.label}
            href={action.link}
            className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-${action.color}-600 hover:bg-${action.color}-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-${action.color}-500`}
          >
            <Icon className="h-4 w-4 mr-2" />
            {action.label}
          </Link>
        );
      })}
    </div>
  );
}