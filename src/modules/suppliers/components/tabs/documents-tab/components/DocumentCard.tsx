// ============= Document Card Component =============
// Card component for individual document display

import React from 'react';
import { Eye, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SupplierDocument } from '../types/documents.types';
import { statusConfig } from '../data/statusConfig';
import { typeConfig } from '../data/typeConfig';
import {
  formatFileSize,
  formatDate,
  getDaysUntilExpiry,
  getExpiryClassName
} from '../utils/documentHelpers';

interface DocumentCardProps {
  document: SupplierDocument;
  onView: (doc: SupplierDocument) => void;
  onDownload: (doc: SupplierDocument) => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document,
  onView,
  onDownload
}) => {
  const status = statusConfig[document.status];
  const type = typeConfig[document.type];
  const StatusIcon = status.icon;
  const TypeIcon = type.icon;

  const daysUntilExpiry = getDaysUntilExpiry(document.expiryDate);

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start space-x-3 flex-1">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <TypeIcon className="w-5 h-5 text-blue-600" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{document.name}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{document.description}</p>

            <div className="flex items-center flex-wrap gap-2 mt-2">
              <span className={cn("px-2 py-1 rounded-full text-xs font-medium", type.color)}>
                {type.label}
              </span>
              <span className={cn("px-2 py-1 rounded-full text-xs font-medium border", status.color)}>
                <StatusIcon className={cn("w-3 h-3 inline mr-1", status.iconColor)} />
                {status.label}
              </span>
              {document.isRequired && (
                <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                  Required
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4">
        <div>
          <p className="font-medium">Uploaded</p>
          <p>{formatDate(document.uploadDate)}</p>
        </div>
        {document.expiryDate && (
          <div>
            <p className="font-medium">Expires</p>
            <p className={getExpiryClassName(daysUntilExpiry)}>
              {formatDate(document.expiryDate)}
              {daysUntilExpiry !== null && (
                <span className="block text-xs">
                  ({daysUntilExpiry > 0 ? `${daysUntilExpiry} days left` : `${Math.abs(daysUntilExpiry)} days overdue`})
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t">
        <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
          <span>v{document.version}</span>
          <span>{formatFileSize(document.fileSize)}</span>
          <span>{document.fileType}</span>
          {document.reviewedBy && (
            <span>Reviewed by {document.reviewedBy}</span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => onView(document)}
            className="px-3 py-1 text-blue-600 hover:bg-blue-50 rounded text-sm border border-blue-200 transition-colors"
          >
            <Eye className="w-4 h-4 inline mr-1" />
            View
          </button>
          <button
            onClick={() => onDownload(document)}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4 inline mr-1" />
            Download
          </button>
        </div>
      </div>

      {document.tags.length > 0 && (
        <div className="mt-3 pt-3 border-t">
          <div className="flex flex-wrap gap-1">
            {document.tags.map((tag, index) => (
              <span key={index} className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-1 rounded text-xs">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
