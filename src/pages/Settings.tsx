import { useState } from 'react';
import { useRouter } from 'next/router';
import { useTheme } from '@/contexts/ThemeContext';
import { VFLogoUpload } from '@/components/settings/VFLogoUpload';
// import { ServiceTemplatesTab } from '@/components/settings/ServiceTemplatesTab';
import { RemindersTab } from '@/components/settings/RemindersTab';
import { SidebarCustomization } from '@/components/settings/SidebarCustomization';
import { SageIntegrationTab } from '@/components/settings/SageIntegrationTab';
import { Palette, Moon, Sun, Settings2, GitBranch, Bell, PanelLeft, Cloud } from 'lucide-react';

type SettingsTab = 'general' | 'sidebar' | 'workflow' | 'reminders' | 'integrations';

export function Settings() {
  const { themeConfig, setTheme, availableThemes } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const router = useRouter();

  const tabs = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'sidebar', label: 'Sidebar', icon: PanelLeft },
    { id: 'workflow', label: 'Workflow Management', icon: GitBranch },
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
          <div className="space-y-6">
            {/* Theme Selection */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
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
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                    }`}
                  >
                    <div className="flex items-center justify-center mb-2">
                      {theme === 'light' && <Sun className="w-6 h-6" />}
                      {theme === 'dark' && <Moon className="w-6 h-6" />}
                      {theme === 'vf' && (
                        <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-500 via-pink-500 to-pink-600" />
                      )}
                      {theme === 'fibreflow' && (
                        <div className="w-6 h-6 rounded bg-blue-600" />
                      )}
                    </div>
                    <div className="text-sm font-medium capitalize">{theme}</div>
                  </button>
                ))}
              </div>
              
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                Current Theme: <strong className="capitalize">{themeConfig.name}</strong>
              </p>
            </div>

            {/* Logo Upload - Available for all themes */}
            <VFLogoUpload />
            
            {/* Additional Settings */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Display Settings</h3>
              
              <div className="space-y-4">
                <label className="flex items-center">
                  <input type="checkbox" className="rounded mr-3" defaultChecked />
                  <span>Enable animations</span>
                </label>
                
                <label className="flex items-center">
                  <input type="checkbox" className="rounded mr-3" defaultChecked />
                  <span>Show tooltips</span>
                </label>
                
                <label className="flex items-center">
                  <input type="checkbox" className="rounded mr-3" />
                  <span>Compact mode</span>
                </label>
              </div>
            </div>
          </div>
        );

      case 'workflow':
        return (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold flex items-center">
                  <GitBranch className="w-5 h-5 mr-2" />
                  Workflow Management
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Configure and manage workflow templates for your projects
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg">
                <h4 className="font-medium mb-2">Workflow Templates</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Create, edit, and manage customizable workflow templates for different project types.
                </p>
                <button
                  onClick={handleWorkflowManagement}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Open Workflow Portal
                </button>
              </div>

              <div className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg opacity-60">
                <h4 className="font-medium mb-2">Project Assignments</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Assign workflow templates to projects and track execution progress.
                </p>
                <button
                  disabled
                  className="bg-gray-300 text-gray-500 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
                >
                  Coming Soon
                </button>
              </div>

              <div className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg opacity-60">
                <h4 className="font-medium mb-2">Analytics & Reports</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  View workflow performance metrics and generate detailed reports.
                </p>
                <button
                  disabled
                  className="bg-gray-300 text-gray-500 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
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

      default:
        return null;
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      {/* Tab Navigation */}
      <div className="mb-6">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as SettingsTab)}
                  className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
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