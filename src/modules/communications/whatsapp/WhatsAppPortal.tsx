/**
 * WhatsApp Portal - Main Page Component
 * URL: /communications/whatsapp
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  Users,
  FileText,
  ScrollText,
  Settings,
  Radio,
} from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import type { WaAdminTab } from './types/wa-admin.types';

// Tab components (will be created next)
import ServicesTab from './components/ServicesTab';
import GroupsTab from './components/GroupsTab';
import TemplatesTab from './components/TemplatesTab';
import LogsTab from './components/LogsTab';
import SettingsTab from './components/SettingsTab';

interface TabConfig {
  id: WaAdminTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  component: React.ComponentType;
}

const tabs: TabConfig[] = [
  { id: 'services', label: 'Services', icon: Radio, component: ServicesTab },
  { id: 'groups', label: 'Groups', icon: Users, component: GroupsTab },
  { id: 'templates', label: 'Templates', icon: FileText, component: TemplatesTab },
  { id: 'logs', label: 'Logs', icon: ScrollText, component: LogsTab },
  { id: 'settings', label: 'Settings', icon: Settings, component: SettingsTab },
];

const WhatsAppPortal: React.FC = () => {
  const [activeTab, setActiveTab] = useState<WaAdminTab>('services');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const ActiveComponent = tabs.find(t => t.id === activeTab)?.component || ServicesTab;
  const activeIndex = tabs.findIndex(t => t.id === activeTab);

  // Keyboard navigation for tabs (WAI-ARIA pattern)
  const handleKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let newIndex = index;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        newIndex = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        e.preventDefault();
        newIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        e.preventDefault();
        newIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        newIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    const newTab = tabs[newIndex];
    if (newTab) {
      setActiveTab(newTab.id);
      tabRefs.current[newIndex]?.focus();
    }
  }, []);

  return (
    <div className="ff-page-container">
      <DashboardHeader
        title="WhatsApp Portal"
        subtitle="Manage WhatsApp services, groups, templates, and message logs"
      />

      {/* Tab Navigation */}
      <div className="ff-card mb-6">
        <div className="border-b border-[var(--ff-border-light)]">
          <div
            className="flex space-x-1 px-4"
            role="tablist"
            aria-label="WhatsApp Portal tabs"
          >
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  ref={(el) => { tabRefs.current[index] = el; }}
                  id={`wa-tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`wa-tabpanel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  className={`
                    flex items-center gap-2 px-4 py-3 text-sm font-medium
                    border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2
                    ${isActive
                      ? 'border-green-500 text-green-600'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                    }
                  `}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-green-500' : ''}`} aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div
          id={`wa-tabpanel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`wa-tab-${activeTab}`}
          tabIndex={0}
          className="p-6"
        >
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
};

export default WhatsAppPortal;
