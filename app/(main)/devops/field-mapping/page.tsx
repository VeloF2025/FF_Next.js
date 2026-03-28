import React from 'react';
import { Database } from 'lucide-react';
import { FieldMappingTable } from './FieldMappingTable';
import { fieldMappings } from './fieldMappingData';

export const metadata = {
  title: 'Field Mapping | DevOps',
  description: 'View business concept to database table and column mappings',
};

export default function FieldMappingPage(): React.ReactNode {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Database className="w-8 h-8 text-blue-500" />
            <h1 className="text-3xl font-bold">Field Mapping</h1>
          </div>
          <p className="text-gray-400">
            Business concept to database table and column mappings. Click column headers to sort, use search to filter.
          </p>
        </div>

        <FieldMappingTable data={fieldMappings} />
      </div>
    </div>
  );
}
