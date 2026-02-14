/**
 * DocumentTypeSelector
 *
 * A selection component for choosing document type before upload.
 * Shows documents grouped by:
 * - OCR-Enabled (with data extraction)
 * - Upload Only (no OCR processing)
 */

import React from 'react';
import {
  DocumentType,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_DESCRIPTIONS,
  DOCUMENT_TYPE_ICONS,
  OCR_ENABLED_DOCUMENTS,
  UPLOAD_ONLY_DOCUMENTS,
  REQUIRED_DOCUMENTS,
  isMultiFileDocument,
} from '@/types/staff-document.types';
import {
  CreditCard,
  Car,
  FileText,
  Award,
  GraduationCap,
  Stethoscope,
  Shield,
  Building2,
  Receipt,
  File,
  Sparkles,
  Upload,
  Check,
  BookOpen,
} from 'lucide-react';

interface DocumentTypeSelectorProps {
  selectedType: DocumentType | null;
  onSelect: (type: DocumentType) => void;
  existingDocumentTypes?: DocumentType[];
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  IdCard: CreditCard,
  BookOpen,
  Car,
  FileText,
  Award,
  GraduationCap,
  Stethoscope,
  Shield,
  Building2,
  Receipt,
  File,
};

export function DocumentTypeSelector({
  selectedType,
  onSelect,
  existingDocumentTypes = [],
}: DocumentTypeSelectorProps) {
  const renderDocumentOption = (type: DocumentType, isOcrEnabled: boolean) => {
    const isSelected = selectedType === type;
    const isRequired = REQUIRED_DOCUMENTS.includes(type);
    const hasExisting = existingDocumentTypes.includes(type);
    const needsMultiFile = isMultiFileDocument(type);
    const IconComponent = iconMap[DOCUMENT_TYPE_ICONS[type]] || File;

    return (
      <button
        key={type}
        type="button"
        onClick={() => onSelect(type)}
        className={`
          w-full p-4 rounded-lg border-2 text-left transition-all
          ${isSelected
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-gray-700 hover:border-gray-500 bg-gray-800/50 hover:bg-gray-800'
          }
        `}
      >
        <div className="flex items-start gap-3">
          <div className={`
            p-2 rounded-lg
            ${isSelected ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-400'}
          `}>
            <IconComponent className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`font-medium ${isSelected ? 'text-white' : 'text-gray-200'}`}>
                {DOCUMENT_TYPE_LABELS[type]}
              </span>
              {isRequired && (
                <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-orange-500/20 text-orange-400">
                  Required
                </span>
              )}
              {hasExisting && (
                <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-green-500/20 text-green-400 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Uploaded
                </span>
              )}
            </div>

            <p className="text-sm text-gray-400 mt-0.5">
              {DOCUMENT_TYPE_DESCRIPTIONS[type]}
            </p>

            {needsMultiFile && (
              <p className="text-xs text-blue-400 mt-1 flex items-center gap-1">
                <Upload className="w-3 h-3" />
                Requires front and back upload
              </p>
            )}
          </div>

          {isSelected && (
            <div className="flex-shrink-0">
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </div>
            </div>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      {/* OCR-Enabled Documents */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-medium text-blue-400">
            Documents with Data Extraction
          </h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          We&apos;ll automatically extract information from these documents
        </p>
        <div className="space-y-2">
          {OCR_ENABLED_DOCUMENTS.map((type) => renderDocumentOption(type, true))}
        </div>
      </div>

      {/* Upload-Only Documents */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Upload className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-medium text-gray-400">
            Upload Only Documents
          </h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          These documents will be saved without automatic data extraction
        </p>
        <div className="space-y-2">
          {UPLOAD_ONLY_DOCUMENTS.map((type) => renderDocumentOption(type, false))}
        </div>
      </div>
    </div>
  );
}

export default DocumentTypeSelector;
