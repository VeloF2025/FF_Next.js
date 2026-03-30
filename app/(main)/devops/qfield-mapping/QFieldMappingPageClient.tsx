'use client';

import React, { useState } from 'react';
import { Table2, Package } from 'lucide-react';
import { QFieldMappingTable } from './QFieldMappingTable';
import { StockImplicationsTab } from './StockImplicationsTab';
import { qfieldMappings, tableOverlaps } from './qfieldMappingData';
import { stockImplications } from './stockImplicationsData';

type TabId = 'mappings' | 'stock';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'mappings', label: 'Field Mappings', icon: <Table2 className="w-4 h-4" /> },
  { id: 'stock', label: 'Stock Implications', icon: <Package className="w-4 h-4" /> },
];

export const QFieldMappingPageClient: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('mappings');

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-[var(--ff-border-light)]" role="tablist" aria-label="QField Mapping views">
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                : 'border-transparent text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div
        id="panel-mappings"
        role="tabpanel"
        aria-labelledby="tab-mappings"
        hidden={activeTab !== 'mappings'}
      >
        {activeTab === 'mappings' && (
          <QFieldMappingTable data={qfieldMappings} overlaps={tableOverlaps} />
        )}
      </div>

      <div
        id="panel-stock"
        role="tabpanel"
        aria-labelledby="tab-stock"
        hidden={activeTab !== 'stock'}
      >
        {activeTab === 'stock' && (
          <StockImplicationsTab data={stockImplications} />
        )}
      </div>
    </div>
  );
};
