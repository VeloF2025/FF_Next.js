// ============= Compliance Alert Component =============
// Alert component for compliance status warnings

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SupplierDocument } from '../types/documents.types';

interface ComplianceAlertProps {
  documents: SupplierDocument[];
}

export const ComplianceAlert: React.FC<ComplianceAlertProps> = ({ documents }) => {
  const expiredCount = documents.filter(d => d.status === 'expired').length;
  const expiringSoonCount = documents.filter(d => d.status === 'expiring_soon').length;

  if (expiredCount === 0 && expiringSoonCount === 0) {
    return null;
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-start space-x-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-medium text-amber-900">Document Compliance Status</h3>
          <p className="text-sm text-amber-700 mt-1">
            {expiredCount} expired documents and {expiringSoonCount} documents expiring soon require attention.
          </p>
          <div className="mt-3">
            <Button variant="secondary" size="sm">Review Compliance</Button>
          </div>
        </div>
      </div>
    </div>
  );
};
