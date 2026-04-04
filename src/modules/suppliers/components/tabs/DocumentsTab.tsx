// ============= Documents Tab =============
// Supplier document management with filtering and compliance tracking

import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSuppliersPortal } from '../../context/SuppliersPortalContext';
import { log } from '@/lib/logger';
import { useDocumentFilters } from './documents-tab/hooks/useDocumentFilters';
import type { SupplierDocument } from './documents-tab/types/documents.types';
import {
  DocumentCard,
  DocumentSummary,
  DocumentFilters,
  NoSupplierState,
  NoDocumentsState,
  ComplianceAlert
} from './documents-tab/components';

export function DocumentsTab() {
  const { selectedSupplier } = useSuppliersPortal();

  // Filter management
  const {
    searchTerm,
    setSearchTerm,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    requirementFilter,
    setRequirementFilter,
    filteredDocuments
  } = useDocumentFilters({
    documents: [] as SupplierDocument[],
    selectedSupplier
  });

  const handleViewDocument = (document: SupplierDocument) => {
    log.info('View document:', { data: document.id }, 'DocumentsTab');
    // Implementation for viewing document
  };

  const handleDownloadDocument = (document: SupplierDocument) => {
    log.info('Download document:', { data: document.id }, 'DocumentsTab');
    // Implementation for downloading document
  };

  // Show empty state if no supplier selected
  if (!selectedSupplier) {
    return <NoSupplierState />;
  }

  const hasActiveFilters =
    searchTerm !== '' ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    requirementFilter !== 'all';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Documents - {selectedSupplier.name}
          </h2>
          <p className="text-muted-foreground mt-1">
            Manage contracts, certifications, compliance documents, and other supplier records
          </p>
        </div>

        <Button className="flex items-center space-x-2"><Upload className="w-4 h-4" /><span>Upload Document</span></Button>
      </div>

      {/* Document Summary */}
      <DocumentSummary documents={filteredDocuments} />

      {/* Filters */}
      <DocumentFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        requirementFilter={requirementFilter}
        onRequirementFilterChange={setRequirementFilter}
        resultCount={filteredDocuments.length}
      />

      {/* Documents Grid */}
      {filteredDocuments.length === 0 ? (
        <NoDocumentsState hasActiveFilters={hasActiveFilters} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredDocuments.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              onView={handleViewDocument}
              onDownload={handleDownloadDocument}
            />
          ))}
        </div>
      )}

      {/* Compliance Alert */}
      <ComplianceAlert documents={filteredDocuments} />
    </div>
  );
}
