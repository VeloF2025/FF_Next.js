/**
 * ModulePage Component
 * Unified page wrapper that renders module header, tabs, and content
 * Uses FibreFlow Design System CSS variables
 *
 * @example
 * ```tsx
 * import { ModulePage } from '@/components/module-page';
 * import { nocConfig } from '@/modules/navigation';
 *
 * export default function MaintenancePage() {
 *   return (
 *     <ModulePage config={nocConfig}>
 *       <MaintenanceDashboard />
 *     </ModulePage>
 *   );
 * }
 * ```
 */

'use client';

import { ModuleTabs, SubTabs, useModuleTabs } from '@/modules/navigation';
import { ModuleHeader } from './ModuleHeader';
import type { ModulePageProps } from './types';

/**
 * ModulePage Component
 *
 * A unified page wrapper that provides:
 * - Module header with icon, title, and optional actions
 * - Horizontal tab navigation
 * - Sub-tabs for 3rd level navigation
 *
 * NOTE: This component does NOT include a layout wrapper.
 * For pages router: Wrap with AppLayout in your page
 * For app router: Use within (main) route group which provides AppRouterLayout
 */
export function ModulePage({
  config,
  children,
  tabBadges = {},
  isLoading = false,
  headerActions,
  hideHeader = false,
  hideTabs = false,
  contentClassName = '',
}: ModulePageProps) {
  const {
    activeTab,
    activeSubTab,
    visibleTabs,
    currentSubTabs,
    handleTabClick,
    handleSubTabClick,
    hasPermission,
  } = useModuleTabs({ config, tabBadges });

  return (
    <div className="flex flex-col min-h-full bg-[var(--ff-bg-primary)]">
      {/* Header Section */}
      <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
        {/* Module Header */}
        {!hideHeader && (
          <div className="px-4 sm:px-6 py-4">
            <ModuleHeader
              title={config.moduleName}
              description={config.description}
              icon={config.icon}
              actions={headerActions}
            />
          </div>
        )}

        {/* Tab Navigation */}
        {!hideTabs && visibleTabs.length > 0 && (
          <div className={`${hideHeader ? 'pt-4' : ''} px-4 sm:px-6 border-t border-[var(--ff-border-light)]`}>
            <ModuleTabs
              tabs={visibleTabs}
              activeTab={activeTab}
              tabBadges={tabBadges}
              hasPermission={hasPermission}
              isLoading={isLoading}
              onTabChange={(tabId) => {
                const tab = visibleTabs.find((t) => t.id === tabId);
                if (tab) handleTabClick(tab);
              }}
            />
          </div>
        )}
      </div>

      {/* Sub-tabs (if current tab has them) */}
      {!hideTabs && currentSubTabs.length > 0 && (
        <div className="px-4 sm:px-6 pt-4 bg-[var(--ff-bg-primary)]">
          <SubTabs
            subTabs={currentSubTabs}
            activeSubTab={activeSubTab}
            isLoading={isLoading}
            onSubTabChange={(subTabId) => {
              const subTab = currentSubTabs.find((st) => st.id === subTabId);
              if (subTab) handleSubTabClick(subTab);
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className={`p-4 sm:p-6 ${contentClassName}`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--ff-primary-500)]" />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export default ModulePage;
