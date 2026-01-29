/**
 * Procurement Settings Tab
 *
 * Main container for procurement configuration with 4 collapsible sections:
 * - Approval Workflows
 * - Number Sequences
 * - Default Terms
 * - Notifications
 */

import { useState } from 'react';
import {
  ShoppingCart,
  ChevronDown,
  Shield,
  Hash,
  FileText,
  Bell,
  RefreshCw,
} from 'lucide-react';
import { ApprovalWorkflowsSection } from './procurement/ApprovalWorkflowsSection';
import { NumberSequencesSection } from './procurement/NumberSequencesSection';
import { DefaultTermsSection } from './procurement/DefaultTermsSection';
import { NotificationsSection } from './procurement/NotificationsSection';

interface Section {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  component: React.ReactNode;
}

export function ProcurementSettingsTab() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['workflows'])
  );
  const [refreshKey, setRefreshKey] = useState(0);

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
  };

  const sections: Section[] = [
    {
      id: 'workflows',
      label: 'Approval Workflows',
      description: 'Configure approval thresholds, assign approvers, and manage workflow rules',
      icon: Shield,
      component: <ApprovalWorkflowsSection key={`wf-${refreshKey}`} />,
    },
    {
      id: 'sequences',
      label: 'Number Sequences',
      description: 'Configure document number prefixes and formats',
      icon: Hash,
      component: <NumberSequencesSection key={`seq-${refreshKey}`} />,
    },
    {
      id: 'terms',
      label: 'Default Terms & Settings',
      description: 'Set default payment terms, currency, and procurement rules',
      icon: FileText,
      component: <DefaultTermsSection key={`terms-${refreshKey}`} />,
    },
    {
      id: 'notifications',
      label: 'Notifications',
      description: 'Configure event notifications and alert channels',
      icon: Bell,
      component: <NotificationsSection key={`notif-${refreshKey}`} />,
    },
  ];

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-5 h-5 text-[var(--ff-primary-400)]" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Procurement Settings
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Configure approval workflows, document numbering, and procurement preferences
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
          title="Refresh all sections"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Collapsible Sections */}
      {sections.map(section => {
        const Icon = section.icon;
        const isExpanded = expandedSections.has(section.id);

        return (
          <div
            key={section.id}
            className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden"
          >
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--ff-primary-500)]/10">
                  <Icon className="w-4 h-4 text-[var(--ff-primary-400)]" />
                </div>
                <div className="text-left">
                  <h4 className="font-medium text-[var(--ff-text-primary)]">
                    {section.label}
                  </h4>
                  <p className="text-xs text-[var(--ff-text-secondary)]">
                    {section.description}
                  </p>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-[var(--ff-text-secondary)] transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            </button>
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-[var(--ff-border-light)]">
                {section.component}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
