import { FileText, MapPin, Home, TrendingUp } from 'lucide-react';
import { SOWListItem } from '../types/sow.types';
import { SOWDocumentType, DocumentStatus } from '@/modules/projects/types/project.types';

interface SOWStatsProps {
  documents: SOWListItem[];
}

export function SOWStats({ documents }: SOWStatsProps) {
  const stats = {
    totalDocuments: documents.length,
    totalPoles: documents
      .filter(d => d.type === SOWDocumentType.POLES)
      .reduce((acc, d) => acc + (d.metadata?.poleCount || 0), 0),
    totalDrops: documents
      .filter(d => d.type === SOWDocumentType.DROPS)
      .reduce((acc, d) => acc + (d.metadata?.dropCount || 0), 0),
    totalCable: documents
      .filter(d => d.type === SOWDocumentType.CABLE)
      .reduce((acc, d) => acc + ((d.metadata?.cableLength || 0) / 1000), 0), // Convert to km
    approvedCount: documents.filter(d => d.status === DocumentStatus.APPROVED).length,
    pendingCount: documents.filter(d => d.status === DocumentStatus.PENDING).length,
    rejectedCount: documents.filter(d => d.status === DocumentStatus.REJECTED).length,
    totalEstimatedCost: documents.reduce((acc, d) => acc + (d.metadata?.estimatedCost || 0), 0)
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--ff-text-secondary)]">Total Documents</p>
            <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{stats.totalDocuments}</p>
            <div className="mt-2 text-xs text-[var(--ff-text-secondary)]">
              <span className="text-green-400">{stats.approvedCount} approved</span>
              {' • '}
              <span className="text-yellow-400">{stats.pendingCount} pending</span>
              {stats.rejectedCount > 0 && (
                <>
                  {' • '}
                  <span className="text-red-400">{stats.rejectedCount} rejected</span>
                </>
              )}
            </div>
          </div>
          <FileText className="h-12 w-12 text-blue-500" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--ff-text-secondary)]">Total Poles</p>
            <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
              {stats.totalPoles.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--ff-text-secondary)] mt-2">Across all projects</p>
          </div>
          <MapPin className="h-12 w-12 text-green-500" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--ff-text-secondary)]">Total Drops</p>
            <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
              {stats.totalDrops.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--ff-text-secondary)] mt-2">Customer connections</p>
          </div>
          <Home className="h-12 w-12 text-purple-500" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--ff-text-secondary)]">Estimated Value</p>
            <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
              ${(stats.totalEstimatedCost / 1000000).toFixed(1)}M
            </p>
            <p className="text-xs text-[var(--ff-text-secondary)] mt-2">Total project value</p>
          </div>
          <TrendingUp className="h-12 w-12 text-orange-500" />
        </div>
      </div>
    </div>
  );
}