// 🟢 WORKING: Main Workflow Portal with comprehensive tabbed navigation
import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { AlertCircle, GitBranch, ArrowLeft } from 'lucide-react';
import { WorkflowPortalProvider } from './context/WorkflowPortalContext';
import { WorkflowTabs } from './components/WorkflowTabs';
import { useWorkflowPortal } from './hooks/useWorkflowPortal';
import { TemplatesTab, EditorTab, ProjectsTab, AnalyticsTab } from './components/tabs';
import type { WorkflowTabId } from './types/portal.types';

interface WorkflowPortalPageProps {
  children?: React.ReactNode;
}

// Portal layout component
function WorkflowPortalLayout({ children }: WorkflowPortalPageProps) {
  const router = useRouter();

  const {
    activeTab,
    isLoading,
    error,
    templateStats,
    setActiveTab,
    setError,
    // refreshData removed - not used in current implementation
  } = useWorkflowPortal();

  // Handle tab changes from URL
  useEffect(() => {
    const tabParam = router.query.tab as WorkflowTabId;
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [router.query.tab, activeTab, setActiveTab]);

  // Handle tab changes
  const handleTabChange = (tabId: WorkflowTabId) => {
    setActiveTab(tabId);

    // Update URL with tab parameter
    router.push({
      pathname: router.pathname,
      query: { ...router.query, tab: tabId }
    }, undefined, { shallow: true });
  };

  // Navigate back to settings
  const handleBackToSettings = () => {
    router.push('/settings?tab=workflow');
  };

  // Handle template edit navigation
  const handleTemplateEdit = (_templateId: string) => {
    setActiveTab('editor');
    // TODO: Pass templateId to editor context
  };

  // Render active tab content
  const renderTabContent = () => {
    if (children) return children;

    switch (activeTab) {
      case 'templates':
        return <TemplatesTab onTemplateEdit={handleTemplateEdit} />;
      case 'editor':
        return <EditorTab />;
      case 'projects':
        return <ProjectsTab />;
      case 'analytics':
        return <AnalyticsTab />;
      default:
        return <TemplatesTab onTemplateEdit={handleTemplateEdit} />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--ff-bg-tertiary)]">
      {/* Portal Header */}
      <div className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] shadow-sm">
        <div className="px-6 py-4">
          {/* Navigation Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-4">
              <button
                onClick={handleBackToSettings}
                className="flex items-center space-x-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
                aria-label="Back to Settings"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">Settings</span>
              </button>
              <div className="h-4 w-px bg-[var(--ff-border-light)]" />
              <div className="flex items-center space-x-3">
                <GitBranch className="w-6 h-6 text-blue-600" />
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Workflow Portal</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                    Manage workflow templates and project assignments
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="hidden lg:flex items-center space-x-6 text-sm">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span className="text-[var(--ff-text-secondary)]">
                  {templateStats.totalTemplates} Templates
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-[var(--ff-text-secondary)]">
                  {templateStats.activeTemplates} Active
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                <span className="text-[var(--ff-text-secondary)]">
                  {templateStats.draftTemplates} Drafts
                </span>
              </div>
            </div>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-400">{error}</span>
              <button
                onClick={() => setError(undefined)}
                className="ml-auto text-red-400 hover:text-red-300 p-1"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {/* Tab Navigation */}
          <WorkflowTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {isLoading && !children ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">Loading workflow data...</p>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-auto">
            {renderTabContent()}
          </div>
        )}
      </div>
    </div>
  );
}

// 🟢 WORKING: Main Workflow Portal with dark mode support using CSS variables

// Main portal page component with error boundary
export function WorkflowPortalPage({ children }: WorkflowPortalPageProps) {
  return (
    <div className="h-screen">
      <WorkflowPortalProvider>
        <WorkflowPortalLayout>
          {children}
        </WorkflowPortalLayout>
      </WorkflowPortalProvider>
    </div>
  );
}

export default WorkflowPortalPage;