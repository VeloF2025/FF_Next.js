import { useState } from 'react';
import { useRouter } from 'next/router';
import { useTheme } from '@/contexts/ThemeContext';
import { VFLogoUpload } from '@/components/settings/VFLogoUpload';
// import { ServiceTemplatesTab } from '@/components/settings/ServiceTemplatesTab';
import { RemindersTab } from '@/components/settings/RemindersTab';
import { SidebarCustomization } from '@/components/settings/SidebarCustomization';
import { SageIntegrationTab } from '@/components/settings/SageIntegrationTab';
import { AccessControlTab } from '@/components/settings/AccessControlTab';
import { ProcurementSettingsTab } from '@/components/settings/ProcurementSettingsTab';
import { Palette, Moon, Sun, Settings2, GitBranch, Bell, PanelLeft, Cloud, Shield, ShoppingCart } from 'lucide-react';

type SettingsTab = 'general' | 'sidebar' | 'workflow' | 'reminders' | 'integrations' | 'access' | 'procurement';

export function Settings() {
  const { themeConfig, setTheme, availableThemes } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const router = useRouter();

  const tabs = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'sidebar', label: 'Sidebar', icon: PanelLeft },
    { id: 'access', label: 'Access Control', icon: Shield },
    { id: 'workflow', label: 'Workflow Management', icon: GitBranch },
    { id: 'procurement', label: 'Procurement', icon: ShoppingCart },
    { id: 'integrations', label: 'Integrations', icon: Cloud },
    { id: 'reminders', label: 'Reminders', icon: Bell }
  ] as const;

  const handleWorkflowManagement = () => {
    router.push('/workflow-portal');
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-6 max-w-4xl">
            {/* Theme Selection */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center text-[var(--ff-text-primary)]">
                <Palette className="w-5 h-5 mr-2" />
                Theme Selection
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {availableThemes.map((theme) => (
                  <button
                    key={theme}
                    onClick={() => setTheme(theme)}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      themeConfig.name === theme
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
                    }`}
                  >
                    <div className="flex items-center justify-center mb-2">
                      {theme === 'light' && <Sun className="w-6 h-6 text-[var(--ff-text-primary)]" />}
                      {theme === 'dark' && <Moon className="w-6 h-6 text-[var(--ff-text-primary)]" />}
                      {theme === 'vf' && (
                        <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-500 via-pink-500 to-pink-600" />
                      )}
                      {theme === 'fibreflow' && (
                        <div className="w-6 h-6 rounded bg-blue-600" />
                      )}
                    </div>
                    <div className="text-sm font-medium capitalize text-[var(--ff-text-primary)]">{theme}</div>
                  </button>
                ))}
              </div>

              <p className="mt-4 text-sm text-[var(--ff-text-secondary)]">
                Current Theme: <strong className="capitalize text-[var(--ff-text-primary)]">{themeConfig.name}</strong>
              </p>
            </div>

            {/* Logo Upload - Available for all themes */}
            <VFLogoUpload />

            {/* Additional Settings */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
              <h3 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">Display Settings</h3>

              <div className="space-y-4">
                <label className="flex items-center text-[var(--ff-text-primary)]">
                  <input type="checkbox" className="rounded mr-3 bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]" defaultChecked />
                  <span>Enable animations</span>
                </label>

                <label className="flex items-center text-[var(--ff-text-primary)]">
                  <input type="checkbox" className="rounded mr-3 bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]" defaultChecked />
                  <span>Show tooltips</span>
                </label>

                <label className="flex items-center text-[var(--ff-text-primary)]">
                  <input type="checkbox" className="rounded mr-3 bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]" />
                  <span>Compact mode</span>
                </label>
              </div>
            </div>
          </div>
        );

      case 'workflow':
        return (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 max-w-4xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold flex items-center text-[var(--ff-text-primary)]">
                  <GitBranch className="w-5 h-5 mr-2" />
                  Workflow Management
                </h3>
                <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                  Configure and manage workflow templates for your projects
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 border border-[var(--ff-border-light)] rounded-lg">
                <h4 className="font-medium mb-2 text-[var(--ff-text-primary)]">Workflow Templates</h4>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
                  Create, edit, and manage customizable workflow templates for different project types.
                </p>
                <button
                  onClick={handleWorkflowManagement}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Open Workflow Portal
                </button>
              </div>

              <div className="p-4 border border-[var(--ff-border-light)] rounded-lg opacity-60">
                <h4 className="font-medium mb-2 text-[var(--ff-text-primary)]">Project Assignments</h4>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
                  Assign workflow templates to projects and track execution progress.
                </p>
                <button
                  disabled
                  className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
                >
                  Coming Soon
                </button>
              </div>

              <div className="p-4 border border-[var(--ff-border-light)] rounded-lg opacity-60">
                <h4 className="font-medium mb-2 text-[var(--ff-text-primary)]">Analytics & Reports</h4>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
                  View workflow performance metrics and generate detailed reports.
                </p>
                <button
                  disabled
                  className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
                >
                  Coming Soon
                </button>
              </div>
            </div>
          </div>
        );

      case 'sidebar':
        return <SidebarCustomization />;

      case 'reminders':
        return <RemindersTab />;

      case 'integrations':
        return <SageIntegrationTab />;

      case 'access':
        return <AccessControlTab />;

      case 'procurement':
        return <ProcurementSettingsTab />;

      default:
        return null;
    }
  };

  // Access Control tab needs full width for the data table
  const isFullWidth = activeTab === 'access' || activeTab === 'procurement';

  return (
    <div className={`p-6 ${isFullWidth ? '' : ''}`}>
      {/* Tab Navigation */}
      <div className="mb-6">
        <div className="border-b border-[var(--ff-border-light)]">
          <nav className="-mb-px flex space-x-6 overflow-x-auto">
            {tabs.map((tab) => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as SettingsTab)}
                  className={`flex items-center space-x-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
                  }`}
                >
                  <IconComponent className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {renderTabContent()}
    </div>
  );
}