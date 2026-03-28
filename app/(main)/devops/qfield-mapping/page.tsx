import React from 'react';
import { MapPin } from 'lucide-react';
import { QFieldMappingTable } from './QFieldMappingTable';
import { qfieldMappings, tableOverlaps } from './qfieldMappingData';

export const metadata = {
  title: 'QField Mapping | DevOps',
  description: 'QField layer to FibreFlow database field mappings, gap analysis, and table overlap audit',
};

export default function QFieldMappingPage(): React.ReactNode {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <MapPin className="w-8 h-8 text-teal-500" />
            <h1 className="text-3xl font-bold">QField Mapping</h1>
          </div>
          <p className="text-gray-400">
            QField GPKG/API layer attributes mapped to FibreFlow database tables. Highlights gaps (not imported) and duplicate tables.
          </p>
        </div>

        <QFieldMappingTable data={qfieldMappings} overlaps={tableOverlaps} />
      </div>
    </div>
  );
}
