'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { SOWListTable } from './components/SOWListTable';
import { SOWFilters } from './components/SOWFilters';
import { SOWStats } from './components/SOWStats';
import { useSOWDocuments } from './hooks/useSOWDocuments';
import { useSOWFilters } from './hooks/useSOWFilters';
import { SOWListItem } from './types/sow.types';

export function SOWListPage() {
  const router = useRouter();
  const [, setSelectedDocument] = useState<SOWListItem | null>(null);
  
  const { sowDocuments, loading, deleteDocument, downloadDocument } = useSOWDocuments();
  const {
    filteredDocuments,
    searchTerm,
    setSearchTerm,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter
  } = useSOWFilters(sowDocuments);

  const handleViewDocument = (doc: SOWListItem) => {
    setSelectedDocument(doc);
    // Navigate to detail view or open modal

  };

  const handleEditDocument = (_doc: SOWListItem) => {
    // Navigate to edit page

  };

  const handleDeleteDocument = async (doc: SOWListItem) => {
    if (window.confirm(`Are you sure you want to delete ${doc.name}?`)) {
      await deleteDocument(doc.id);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center">
          <FileSpreadsheet className="h-8 w-8 text-blue-600 mr-3" />
          <div>
            <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">SOW Documents</h1>
            <p className="text-[var(--ff-text-secondary)]">Manage Statement of Work documents</p>
          </div>
        </div>
        <button
          onClick={() => router.push('/projects/sow/upload')}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Upload className="h-5 w-5 mr-2" />
          Upload SOW
        </button>
      </div>

      {/* Stats */}
      <SOWStats documents={sowDocuments} />

      {/* Filters */}
      <SOWFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      {/* Table */}
      {filteredDocuments.length === 0 ? (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-8 text-center">
          <FileSpreadsheet className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
          <p className="text-[var(--ff-text-secondary)]">No SOW documents found</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-2">
            Try adjusting your filters or upload a new document
          </p>
        </div>
      ) : (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow">
          <SOWListTable
            documents={filteredDocuments}
            onView={handleViewDocument}
            onEdit={handleEditDocument}
            onDelete={handleDeleteDocument}
            onDownload={downloadDocument}
          />
        </div>
      )}
    </div>
  );
}