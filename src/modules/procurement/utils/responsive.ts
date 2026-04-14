// 🟢 WORKING: Responsive design utilities for procurement portal
export const breakpoints = {
  mobile: '(max-width: 767px)',
  tablet: '(min-width: 768px) and (max-width: 1023px)',
  desktop: '(min-width: 1024px)',
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px'
};

/**
 * Responsive CSS classes for procurement portal components
 */
export const responsiveClasses = {
  // Tab navigation classes
  tabContainer: 'flex space-x-1 overflow-x-auto scrollbar-hide sm:space-x-2',
  tabButton: `
    relative py-2 px-3 sm:py-3 sm:px-4 border-b-2 font-medium text-xs sm:text-sm 
    whitespace-nowrap flex items-center gap-1 sm:gap-2 transition-all duration-200 
    min-w-fit
  `,
  
  // Project filter classes
  projectFilter: 'min-w-[250px] sm:min-w-[280px] lg:min-w-[300px] justify-between',
  projectFilterDropdown: 'absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50',
  
  // Content area classes
  contentArea: 'flex-1 overflow-hidden',
  contentScroll: 'h-full overflow-auto',
  
  // Card grid classes
  cardGrid: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6',
  statGrid: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6',
  
  // Table classes
  tableContainer: 'overflow-x-auto',
  table: 'min-w-full divide-y divide-gray-200',
  
  // Form classes
  formGrid: 'grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6',
  formSection: 'space-y-4 sm:space-y-6',
  
  // Button groups
  buttonGroup: 'flex flex-col sm:flex-row gap-2 sm:gap-3',
  actionButtons: 'flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap'
};

/**
 * Hook to detect current screen size
 */
export function useScreenSize() {
  if (typeof window === 'undefined') {
    return { isMobile: false, isTablet: false, isDesktop: true };
  }

  const isMobile = window.matchMedia(breakpoints.mobile).matches;
  const isTablet = window.matchMedia(breakpoints.tablet).matches;
  const isDesktop = window.matchMedia(breakpoints.desktop).matches;

  return { isMobile, isTablet, isDesktop };
}

/**
 * Responsive tab configuration
 */
export const responsiveTabConfig = {
  mobile: {
    maxVisibleTabs: 4,
    showLabels: false,
    iconOnly: true,
    scrollable: true
  },
  tablet: {
    maxVisibleTabs: 6,
    showLabels: true,
    iconOnly: false,
    scrollable: true
  },
  desktop: {
    maxVisibleTabs: 8,
    showLabels: true,
    iconOnly: false,
    scrollable: false
  }
};

/**
 * Hook to get responsive configuration for current screen
 */
export function useResponsiveTabConfig() {
  const { isMobile, isTablet } = useScreenSize();

  if (isMobile) return responsiveTabConfig.mobile;
  if (isTablet) return responsiveTabConfig.tablet;
  return responsiveTabConfig.desktop;
}

/**
 * Mobile-specific utilities
 */
export const mobileUtils = {
  // Swipe gesture handling for tab navigation
  handleSwipeNavigation: (direction: 'left' | 'right', currentTab: string, availableTabs: string[], onTabChange: (tab: string) => void) => {
    const currentIndex = availableTabs.indexOf(currentTab);
    
    if (direction === 'left' && currentIndex < availableTabs.length - 1) {
      onTabChange(availableTabs[currentIndex + 1]!);
    } else if (direction === 'right' && currentIndex > 0) {
      onTabChange(availableTabs[currentIndex - 1]!);
    }
  },
  
  // Touch-friendly spacing
  touchSpacing: {
    minTouchTarget: '44px', // Apple's recommended minimum touch target size
    padding: '12px',
    margin: '8px'
  }
};

/**
 * CSS classes for different screen sizes
 */
export const screenClasses = {
  hideOnMobile: 'hidden sm:block',
  hideOnTablet: 'hidden lg:block sm:hidden',
  hideOnDesktop: 'lg:hidden',
  showOnMobile: 'sm:hidden',
  showOnTablet: 'hidden sm:block lg:hidden',
  showOnDesktop: 'hidden lg:block'
};

/**
 * Portal-specific responsive breakdowns
 */
export const portalResponsive = {
  // Header layout
  header: {
    mobile: 'flex flex-col space-y-4',
    tablet: 'flex flex-col space-y-4',
    desktop: 'flex items-center justify-between'
  },
  
  // Navigation layout  
  navigation: {
    mobile: 'overflow-x-auto scrollbar-hide',
    tablet: 'overflow-x-auto scrollbar-hide',
    desktop: 'flex space-x-1'
  },
  
  // Content layout
  content: {
    mobile: 'p-4',
    tablet: 'p-6',
    desktop: 'p-6'
  }
};