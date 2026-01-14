/**
 * CheckInSummary Component
 * Shows check-in result after submission
 */

import React from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Car,
  User,
  Calendar,
} from 'lucide-react';
import type { CheckRecord } from '../../types/check-in.types';

interface CheckInSummaryProps {
  record: CheckRecord;
  vehicleRegistration: string;
  onDone: () => void;
  onViewDetails?: () => void;
}

export function CheckInSummary({
  record,
  vehicleRegistration,
  onDone,
  onViewDetails,
}: CheckInSummaryProps) {
  const getStatusConfig = () => {
    if (record.hasCriticalIssues) {
      return {
        icon: XCircle,
        iconColor: 'text-red-500',
        bgColor: 'bg-red-50 dark:bg-red-900/20',
        borderColor: 'border-red-200 dark:border-red-800',
        title: 'Critical Issues Found',
        subtitle: 'Vehicle use blocked until issues are resolved',
      };
    }
    if (record.hasMinorIssues) {
      return {
        icon: AlertTriangle,
        iconColor: 'text-amber-500',
        bgColor: 'bg-amber-50 dark:bg-amber-900/20',
        borderColor: 'border-amber-200 dark:border-amber-800',
        title: 'Check-In Complete',
        subtitle: 'Minor issues noted - vehicle can be used',
      };
    }
    return {
      icon: CheckCircle,
      iconColor: 'text-green-500',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
      borderColor: 'border-green-200 dark:border-green-800',
      title: 'All Checks Passed',
      subtitle: 'Vehicle ready for use',
    };
  };

  const config = getStatusConfig();
  const StatusIcon = config.icon;

  const isOffline = record.syncStatus === 'pending';

  return (
    <div className="max-w-md mx-auto p-4">
      {/* Status card */}
      <div className={`${config.bgColor} ${config.borderColor} border rounded-xl p-6 text-center`}>
        <div className="flex justify-center mb-4">
          <div className={`p-4 rounded-full ${config.bgColor}`}>
            <StatusIcon className={`w-16 h-16 ${config.iconColor}`} />
          </div>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          {config.title}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {config.subtitle}
        </p>
      </div>

      {/* Offline indicator */}
      {isOffline && (
        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-sm text-amber-700 dark:text-amber-400">
              Saved offline - will sync when connected
            </span>
          </div>
        </div>
      )}

      {/* Details */}
      <div className="mt-6 space-y-3">
        <div className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
          <Car className="w-5 h-5" />
          <span>{vehicleRegistration}</span>
        </div>
        <div className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
          <User className="w-5 h-5" />
          <span>{record.driverName}</span>
        </div>
        <div className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
          <Calendar className="w-5 h-5" />
          <span>
            {new Date(record.checkDate).toLocaleDateString()} at{' '}
            {record.checkTime.substring(0, 5)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-8 space-y-3">
        {onViewDetails && (
          <button
            type="button"
            onClick={onViewDetails}
            className="w-full py-3 px-4 border rounded-lg font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            View Details
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className="w-full py-3 px-4 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600"
        >
          Done
        </button>
      </div>
    </div>
  );
}
