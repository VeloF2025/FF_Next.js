import Link from 'next/link';
import { useRouter } from 'next/router';
import type { NavSection, SidebarStyles } from './types';
import type { ThemeConfig } from '@/types/theme.types';

interface NavigationMenuProps {
  visibleNavItems: NavSection[];
  isCollapsed: boolean;
  sidebarStyles: SidebarStyles;
  themeConfig: ThemeConfig;
}

export function NavigationMenu({ visibleNavItems, isCollapsed, sidebarStyles, themeConfig }: NavigationMenuProps) {
  const router = useRouter();
  const pathname = router.pathname;

  return (
    <>
      {visibleNavItems.map((section, idx) => (
        <div key={idx} className={`${isCollapsed ? 'px-2' : 'px-4'} mb-6`}>
          {!isCollapsed && (
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-3 px-2"
              style={{ color: sidebarStyles.textColorTertiary }}
            >
              {section.section}
            </div>
          )}
          <div className="space-y-1">
            {section.items.map((item) => {
              const isActive = pathname === item.to || pathname.startsWith(item.to + '/');
              return (
              <Link
                key={item.to}
                href={item.to}
                className={`flex items-center rounded-lg transition-all duration-200 relative group ${
                  isCollapsed ? 'px-3 py-3 justify-center' : 'px-3 py-2 space-x-3'
                }`}
                style={{
                  backgroundColor: isActive
                    ? themeConfig.colors.primary[500]
                    : 'transparent',
                  color: isActive
                    ? '#ffffff'
                    : sidebarStyles.textColorSecondary
                }}
                title={isCollapsed ? item.label : undefined}
                onMouseEnter={(e) => {
                  const navLink = e.currentTarget;
                  if (!isActive) {
                    navLink.style.backgroundColor = themeConfig.colors.surface.sidebarSecondary || themeConfig.colors.surface.secondary;
                    navLink.style.color = sidebarStyles.textColor;
                  }
                }}
                onMouseLeave={(e) => {
                  const navLink = e.currentTarget;
                  if (!isActive) {
                    navLink.style.backgroundColor = 'transparent';
                    navLink.style.color = sidebarStyles.textColorSecondary;
                  }
                }}
              >
                <item.icon className={`${isCollapsed ? 'w-5 h-5' : 'w-5 h-5'} flex-shrink-0`} />
                {!isCollapsed && (
                  <span className="text-sm font-medium truncate">{item.label}</span>
                )}

                {/* Tooltip for collapsed sidebar */}
                {isCollapsed && (
                  <div
                    className="absolute left-full ml-2 px-2 py-1 text-sm rounded-md shadow-lg border opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 whitespace-nowrap"
                    style={{
                      backgroundColor: themeConfig.colors.surface.elevated,
                      color: themeConfig.colors.text.primary,
                      borderColor: themeConfig.colors.border.primary
                    }}
                  >
                    {item.label}
                  </div>
                )}
              </Link>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}