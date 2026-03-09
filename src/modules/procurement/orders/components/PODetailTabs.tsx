// ============= PO Detail Tabs Component =============
// Tab navigation for PO detail modal

import React from 'react';
import {
  FileText,
  Package,
  Truck,
  FileCheck,
  Clock,
  Paperclip,
  LucideIcon
} from 'lucide-react';

interface Tab {
  key: string;
  label: string;
  icon: LucideIcon;
}

const tabs: Tab[] = [
  { key: 'details', label: 'Details', icon: FileText },
  { key: 'items', label: 'Line Items', icon: Package },
  { key: 'delivery', label: 'Delivery', icon: Truck },
  { key: 'invoices', label: 'Invoices', icon: FileCheck },
  { key: 'documents', label: 'Documents', icon: Paperclip },
  { key: 'history', label: 'History', icon: Clock }
];

interface PODetailTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const PODetailTabs: React.FC<PODetailTabsProps> = ({
  activeTab,
  onTabChange
}) => {
  return (
    <div className="border-b">
      <nav className="flex space-x-8 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`py-4 px-2 border-b-2 font-medium text-sm flex items-center space-x-2 ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-muted-foreground hover:border-border'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};
