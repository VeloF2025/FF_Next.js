import type { SidebarStyles } from './types';

interface NavigationMenuSkeletonProps {
  isCollapsed: boolean;
  sidebarStyles: SidebarStyles;
}

const SECTION_ROW_COUNTS = [3, 4, 3, 2];

export function NavigationMenuSkeleton({ isCollapsed, sidebarStyles }: NavigationMenuSkeletonProps) {
  const barColor = sidebarStyles.borderColor;

  return (
    <div aria-busy="true" aria-label="Loading navigation" className="animate-pulse">
      {SECTION_ROW_COUNTS.map((rowCount, sectionIdx) => (
        <div key={sectionIdx} className="mb-4 px-3">
          {!isCollapsed && (
            <div
              className="h-3 w-20 rounded mb-2 opacity-40"
              style={{ backgroundColor: barColor }}
            />
          )}
          <div className="space-y-1">
            {Array.from({ length: rowCount }).map((_, rowIdx) => (
              <div
                key={rowIdx}
                className={`flex items-center rounded-lg ${
                  isCollapsed ? 'px-3 py-3 justify-center' : 'px-3 py-2 space-x-3'
                }`}
              >
                <div
                  className="w-5 h-5 rounded flex-shrink-0 opacity-60"
                  style={{ backgroundColor: barColor }}
                />
                {!isCollapsed && (
                  <div
                    className="h-3 rounded flex-1 opacity-50"
                    style={{
                      backgroundColor: barColor,
                      maxWidth: `${60 + ((rowIdx * 13) % 30)}%`,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
