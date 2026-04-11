/**
 * Expiry Alert Component
 *
 * Displays important alerts for document issues
 */

import { AlertTriangle, XCircle, Info, AlertCircle } from 'lucide-react';
import type { DocumentAlert } from '../types/documentReport.types';

interface ExpiryAlertProps {
  alerts: DocumentAlert[];
}

const SEVERITY_STYLES = {
  error: {
    icon: XCircle,
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-800',
    iconColor: 'text-red-600',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    textColor: 'text-yellow-800',
    iconColor: 'text-yellow-600',
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-800',
    iconColor: 'text-blue-600',
  },
};

export default function ExpiryAlert({ alerts }: ExpiryAlertProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert, index) => {
        const styles = SEVERITY_STYLES[alert.severity];
        const IconComponent = styles.icon;

        return (
          <div
            key={index}
            className={`
              flex items-start gap-3 p-3 rounded-lg border
              ${styles.bgColor}
              ${styles.borderColor}
            `}
          >
            <IconComponent className={`flex-shrink-0 mt-0.5 ${styles.iconColor}`} size={20} />
            <p className={`text-sm font-medium ${styles.textColor}`}>{alert.message}</p>
          </div>
        );
      })}
    </div>
  );
}
