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
  MessageCircle,
} from 'lucide-react';
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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
          <MessageCircle className="w-7 h-7 text-[var(--ff-primary)]" />
          WhatsApp Portal
        </h1>
        <p className="text-[var(--ff-text-secondary)]">
          Manage WhatsApp services, groups, templates, and message logs
        </p>
      </div>

      {/* Tab Bar */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav
          className="flex gap-1 -mb-px"
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
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div
        id={`wa-tabpanel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`wa-tab-${activeTab}`}
        tabIndex={0}
      >
        <ActiveComponent />
      </div>
    </div>
  );
};

export default WhatsAppPortal;
