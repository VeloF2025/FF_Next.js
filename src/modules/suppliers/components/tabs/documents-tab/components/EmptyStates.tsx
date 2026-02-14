// ============= Empty States Components =============
// Empty state components for no supplier and no documents

import React from 'react';
import { FolderOpen, FileText } from 'lucide-react';

export const NoSupplierState: React.FC = () => {
  return (
    <div className="text-center py-12">
      <FolderOpen className="mx-auto h-12 w-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-2">Select a Supplier</h3>
      <p className="text-muted-foreground">
        Choose a supplier from the Company Profile tab to view their documents, certifications, and compliance records.
      </p>
    </div>
  );
};

interface NoDocumentsStateProps {
  hasActiveFilters: boolean;
}

export const NoDocumentsState: React.FC<NoDocumentsStateProps> = ({ hasActiveFilters }) => {
  return (
    <div className="text-center py-12 bg-card rounded-lg border border-border">
      <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-2">No Documents Found</h3>
      <p className="text-muted-foreground">
        {hasActiveFilters
          ? 'No documents match your current filters.'
          : 'No documents have been uploaded for this supplier yet.'}
      </p>
    </div>
  );
};
