import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermission } from '@/hooks/usePermission';
import { navItems } from './sidebar/navigationConfig';
import { filterNavigationItemsRBAC, getSidebarStyles } from './sidebar/sidebarUtils';
import { SidebarHeader } from './sidebar/SidebarHeader';
import { NavigationMenu } from './sidebar/NavigationMenu';
import { CollapseToggle } from './sidebar/CollapseToggle';
import { useSidebarPreferences } from './sidebar/hooks/useSidebarPreferences';
import { buildMainSectionItems } from './sidebar/config/customizableItems';
import type { SidebarProps, NavSection } from './sidebar/types';

export function Sidebar({ isOpen, isCollapsed, onCollapse }: SidebarProps) {
  const { currentUser } = useAuth();
  const { themeConfig } = useTheme();
  const { can } = usePermission();
  const { mainSectionItems } = useSidebarPreferences();

  // Build nav items with customized MAIN section
  const customizedNavItems = useMemo(() => {
    // Build the custom main section based on user preferences
    const customMainSection: NavSection = {
      section: 'MAIN',
      sectionId: 'main',
      isCollapsible: true,
      defaultExpanded: true,
      items: buildMainSectionItems(mainSectionItems),
    };

    // Replace the main section with the customized one
    return navItems.map(section =>
      section.sectionId === 'main' ? customMainSection : section
    );
  }, [mainSectionItems]);

  // Use RBAC-based filtering with permission keys from database
  const visibleNavItems = filterNavigationItemsRBAC(customizedNavItems, can);
  const sidebarStyles = getSidebarStyles(themeConfig);
  
  return (
    <>
      {/* Sidebar */}
      <aside 
        className={`
          fixed left-0 top-0 h-full shadow-lg transition-all duration-300 z-30 flex flex-col
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 
          ${isCollapsed ? 'lg:w-16' : 'lg:w-64'}
          ${isCollapsed ? 'w-16' : 'w-64'}
        `}
        style={{
          backgroundColor: sidebarStyles.backgroundColor,
          borderRight: `1px solid ${sidebarStyles.borderColor}`
        }}
      >
        <div className="flex flex-col h-full">
          <nav className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            <SidebarHeader 
              isCollapsed={isCollapsed}
              currentUser={currentUser}
              sidebarStyles={sidebarStyles}
              themeConfig={themeConfig}
            />
            
            <NavigationMenu 
              visibleNavItems={visibleNavItems}
              isCollapsed={isCollapsed}
              sidebarStyles={sidebarStyles}
              themeConfig={themeConfig}
            />
          </nav>

          <CollapseToggle 
            isCollapsed={isCollapsed}
            onCollapse={onCollapse}
            sidebarStyles={sidebarStyles}
            themeConfig={themeConfig}
          />
        </div>
      </aside>
    </>
  );
}