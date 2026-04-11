/**
 * Department Card Component
 * Displays department summary in a card format
 */

import { Card, CardContent } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import { Users, User, UserMinus, Building2 } from 'lucide-react';
import type { Department } from '@/types/staff/department.types';

interface DepartmentCardProps {
  department: Department;
  onClick?: () => void;
}

export function DepartmentCard({ department, onClick }: DepartmentCardProps) {
  return (
    <div onClick={onClick} className="cursor-pointer">
      <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] hover:border-blue-500/50 transition-colors">
        <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="font-medium text-[var(--ff-text-primary)]">
                {department.name}
              </h3>
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                {department.code}
              </p>
            </div>
          </div>
          {!department.isActive && (
            <Badge variant="secondary" className="bg-gray-500/20 text-gray-400">
              Inactive
            </Badge>
          )}
        </div>

        {department.description && (
          <p className="text-sm text-[var(--ff-text-secondary)] mb-3 line-clamp-2">
            {department.description}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-[var(--ff-text-tertiary)] mb-1">
              <Users className="w-3 h-3" />
              <span className="text-xs">Total</span>
            </div>
            <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
              {department.staffCount}
            </p>
          </div>
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-green-400 mb-1">
              <User className="w-3 h-3" />
              <span className="text-xs">Active</span>
            </div>
            <p className="text-lg font-semibold text-green-400">
              {department.activeCount}
            </p>
          </div>
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-yellow-400 mb-1">
              <UserMinus className="w-3 h-3" />
              <span className="text-xs">Leave</span>
            </div>
            <p className="text-lg font-semibold text-yellow-400">
              {department.onLeaveCount}
            </p>
          </div>
        </div>

        {department.managerName && (
          <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
            <User className="w-4 h-4" />
            <span>Manager: {department.managerName}</span>
          </div>
        )}
      </CardContent>
      </Card>
    </div>
  );
}
