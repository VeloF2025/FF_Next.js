import React, { useState } from 'react';
import { FileText, Upload, AlertTriangle } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';
import type { SupplierDocument } from '@/types/supplier/base.types';
import { DocumentType } from '@/types/supplier/base.types';

export interface DocumentsTabProps {}

export const DocumentsTab: React.FC<DocumentsTabProps> = () => {
  const [documents] = useState<SupplierDocument[]>([
    {
      id: '1',
      type: DocumentType.TAX_CLEARANCE,
      name: 'Tax Clearance Certificate',
      url: '#',
      expiryDate: '2024-12-31',
      uploadedDate: '2024-01-15',
      uploadedBy: 'system',
      status: 'approved'
    },
    {
      id: '2',
      type: DocumentType.BEE_CERTIFICATE,
      name: 'BEE Certificate Level 4',
      url: '#',
      expiryDate: '2025-03-15',
      uploadedDate: '2024-03-01',
      uploadedBy: 'system',
      status: 'approved'
    },
    {
      id: '3',
      type: DocumentType.INSURANCE,
      name: 'Public Liability Insurance',
      url: '#',
      expiryDate: '2024-09-30',
      uploadedDate: '2023-09-15',
      uploadedBy: 'system',
      status: 'pending'
    }
  ]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'text-green-600 bg-green-50';
      case 'pending': return 'text-yellow-600 bg-yellow-50';
      case 'rejected': return 'text-red-600 bg-red-50';
      case 'expired': return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900';
      default: return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900';
    }
  };

  const getDocumentIcon = (_type: string) => {
    return <FileText className="h-5 w-5 text-gray-500 dark:text-gray-400" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Document Management</h2>
        <VelocityButton>
          <Upload className="h-4 w-4 mr-2" />
          Upload Document
        </VelocityButton>
      </div>

      <div className="grid gap-4">
        {documents.map((doc) => (
          <GlassCard key={doc.id}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                {getDocumentIcon(doc.type)}
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">{doc.name}</h3>
                  <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400 mt-1">
                    <span>Uploaded: {new Date(doc.uploadedDate).toISOString().split('T')[0]}</span>
                    {doc.expiryDate && (
                      <span>Expires: {new Date(doc.expiryDate).toISOString().split('T')[0]}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(doc.status || 'pending')}`}>
                  {doc.status}
                </span>
                <VelocityButton size="sm" variant="outline">
                  View
                </VelocityButton>
                <VelocityButton size="sm">
                  Replace
                </VelocityButton>
              </div>
            </div>
            {doc.expiryDate && new Date(doc.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && (
              <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                This document expires soon. Please upload a renewed version.
              </div>
            )}
          </GlassCard>
        ))}
      </div>
    </div>
  );
};
