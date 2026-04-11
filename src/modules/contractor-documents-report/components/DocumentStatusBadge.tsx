/**
 * Document Status Badge Component
 *
 * Displays a colored badge with icon and label for document status
 */

import { CheckCircle, Clock, AlertTriangle, XCircle, RefreshCw, Square } from 'lucide-react';
import type { DocumentDisplayStatus } from '../types/documentReport.types';
import { getStatusBadgeProps } from '../utils/documentStatusRules';

interface DocumentStatusBadgeProps {
  status: DocumentDisplayStatus;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const ICON_COMPONENTS = {
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Square,
};

export default function DocumentStatusBadge({
  status,
  size = 'md',
  showLabel = true,
}: DocumentStatusBadgeProps) {
  const props = getStatusBadgeProps(status);
  const IconComponent = ICON_COMPONENTS[props.icon as keyof typeof ICON_COMPONENTS];

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  };

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16,
  };

  return (
    <div
      className={`
        inline-flex items-center gap-1.5 rounded-full border
        ${sizeClasses[size]}
        ${props.bgColor}
        ${props.textColor}
        ${props.borderColor}
      `}
    >
      <IconComponent size={iconSizes[size]} />
      {showLabel && <span className="font-medium">{props.label}</span>}
    </div>
  );
}
