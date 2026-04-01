'use client';

import React, { useState } from 'react';
import { Database, Table2, GitBranch } from 'lucide-react';
import { FieldMappingTable } from './FieldMappingTable';
import { FieldMappingSpiderweb } from './FieldMappingSpiderweb';
import { fieldMappings } from './fieldMappingData';

type ViewMode = 'table' | 'spiderweb';

export default function FieldMappingPage(): React.ReactNode {
  const [view, setView] = useState<ViewMode>('table');

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Database className="w-8 h-8 text-blue-500" />
              <div>
                <h1 className="text-3xl font-bold">Field Mapping</h1>
                <p className="text-gray-400 mt-1">
                  Business concept to database table and column mappings.
                </p>
              </div>
            </div>
            {/* View toggle */}
            <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700">
              <button
                onClick={() => setView('table')}
                aria-label="Table view"
                aria-pressed={view === 'table'}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  view === 'table'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Table2 className="w-4 h-4" />
                Table
              </button>
              <button
                onClick={() => setView('spiderweb')}
                aria-label="Spiderweb view"
                aria-pressed={view === 'spiderweb'}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  view === 'spiderweb'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <GitBranch className="w-4 h-4" />
                Spiderweb
              </button>
            </div>
          </div>
        </div>

        {view === 'table' ? (
          <FieldMappingTable data={fieldMappings} />
        ) : (
          <FieldMappingSpiderweb />
        )}
      </div>
    </div>
  );
}
