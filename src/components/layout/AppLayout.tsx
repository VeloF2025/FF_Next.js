import { useState, useEffect, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
// import { useTheme } from '@/contexts/ThemeContext'; // Ready for future use
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
// import { ConnectionStatus } from '@/components/realtime/ConnectionStatus'; // Disabled - WebSocket not configured
import dynamic from 'next/dynamic';

// Dynamically import components that use router to avoid SSR issues
const Sidebar = dynamic(() => import('./Sidebar').then(mod => ({ default: mod.Sidebar })), { ssr: false });
const Header = dynamic(() => import('./Header').then(mod => ({ default: mod.Header })), { ssr: false });
const Footer = dynamic(() => import('./Footer').then(mod => ({ default: mod.Footer })), { ssr: false });
const ChatWidget = dynamic(() => import('@/modules/help-center/components/ChatWidget').then(mod => ({ default: mod.ChatWidget })), { ssr: false });
const AccountingNav = dynamic(() => import('@/components/accounting/AccountingNav').then(mod => ({ default: mod.AccountingNav })), { ssr: false });
const ProcurementNav = dynamic(() => import('@/components/procurement/ProcurementNav').then(mod => ({ default: mod.ProcurementNav })), { ssr: false });
const FleetNav = dynamic(() => import('@/components/fleet/FleetNav').then(mod => ({ default: mod.FleetNav })), { ssr: false });
const SOWNav = dynamic(() => import('@/components/sow/SOWNav').then(mod => ({ default: mod.SOWNav })), { ssr: false });
const AnalyticsNav = dynamic(() => import('@/components/analytics/AnalyticsNav').then(mod => ({ default: mod.AnalyticsNav })), { ssr: false });
const SystemNav = dynamic(() => import('@/components/system/SystemNav').then(mod => ({ default: mod.SystemNav })), { ssr: false });

interface PageMeta {
  title: string;
  breadcrumbs?: string[];
  actions?: React.ReactNode;
}

interface AppLayoutProps {
  children: ReactNode;
  hideHeader?: boolean;
}

export function AppLayout({ children, hideHeader = false }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Initialize with false to match SSR - load from localStorage in useEffect
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const pathname = usePathname();
  const { currentUser, loading } = useAuth();
  // Theme hook ready for future use
  // const { theme } = useTheme();

  // Load sidebar state from localStorage after hydration (prevents SSR mismatch)
  useEffect(() => {
    const saved = localStorage.getItem('fibreflow-sidebar-collapsed');
    if (saved) {
      setSidebarCollapsed(JSON.parse(saved));
    }
    setIsHydrated(true);
  }, []);

  // Save sidebar state to localStorage when it changes (only after initial hydration)
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem('fibreflow-sidebar-collapsed', JSON.stringify(sidebarCollapsed));
    }
  }, [sidebarCollapsed, isHydrated]);

  // Close mobile sidebar when route changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Track page visits for dynamic dashboard tools
  useEffect(() => {
    if (!pathname || !currentUser) return;
    if (pathname.startsWith('/auth') || pathname.startsWith('/api')) return;

    const controller = new AbortController();
    fetch('/api/tracking/page-visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route: pathname }),
      signal: controller.signal,
    }).catch(() => {});

    return () => controller.abort();
  }, [pathname, currentUser]);

  // Get page metadata based on current route
  const getPageMeta = (): PageMeta => {
    const path = pathname || '/';
    const segments = path.split('/').filter(Boolean);

    // Dashboard
    if (path.includes('dashboard')) {
      return {
        title: 'Dashboard',
        breadcrumbs: ['Home', 'Dashboard'],
      };
    }

    // Project Management
    if (path.includes('projects')) {
      if (segments.includes('create')) {
        return {
          title: 'Create Project',
          breadcrumbs: ['Home', 'Projects', 'Create'],
        };
      }
      if (segments.length > 2) {
        return {
          title: 'Project Details',
          breadcrumbs: ['Home', 'Projects', 'Details'],
        };
      }
      return {
        title: 'Projects',
        breadcrumbs: ['Home', 'Projects'],
      };
    }

    // Pole Tracker
    if (path.includes('pole-tracker')) {
      return {
        title: 'Pole Tracker',
        breadcrumbs: ['Home', 'Project Management', 'Pole Tracker'],
      };
    }

    // Clients
    if (path.includes('clients')) {
      if (segments.includes('create') || segments.includes('new')) {
        return {
          title: 'Add Client',
          breadcrumbs: ['Home', 'Clients', 'Add'],
        };
      }
      if (segments.length > 2) {
        return {
          title: 'Client Details',
          breadcrumbs: ['Home', 'Clients', 'Details'],
        };
      }
      return {
        title: 'Clients',
        breadcrumbs: ['Home', 'Clients'],
      };
    }

    // Staff Management
    if (path.includes('staff')) {
      if (segments.includes('create') || segments.includes('new')) {
        return {
          title: 'Add Staff Member',
          breadcrumbs: ['Home', 'Staff', 'Add'],
        };
      }
      if (segments.includes('import')) {
        return {
          title: 'Import Staff',
          breadcrumbs: ['Home', 'Staff', 'Import'],
        };
      }
      if (segments.includes('settings')) {
        return {
          title: 'Staff Settings',
          breadcrumbs: ['Home', 'Staff', 'Settings'],
        };
      }
      if (segments.length > 2) {
        return {
          title: 'Staff Details',
          breadcrumbs: ['Home', 'Staff', 'Details'],
        };
      }
      return {
        title: 'Staff Management',
        breadcrumbs: ['Home', 'Staff'],
      };
    }

    // Accounting
    if (path.includes('accounting')) {
      return {
        title: 'Accounting',
        breadcrumbs: ['Home', 'Accounting'],
      };
    }

    // Procurement
    if (path.includes('procurement')) {
      return {
        title: 'Procurement',
        breadcrumbs: ['Home', 'Procurement'],
      };
    }

    // Suppliers
    if (path.includes('suppliers')) {
      return {
        title: 'Suppliers',
        breadcrumbs: ['Home', 'Suppliers'],
      };
    }

    // Contractors
    if (path.includes('contractors')) {
      return {
        title: 'Contractors',
        breadcrumbs: ['Home', 'Contractors'],
      };
    }

    // WhatsApp Portal - uses its own header like Fleet Drivers
    if (path.includes('communications/whatsapp')) {
      return {
        title: 'FibreFlow',
        breadcrumbs: ['Home'],
      };
    }

    // Communications
    if (path.includes('communications') || path.includes('meetings')) {
      return {
        title: 'Communications',
        breadcrumbs: ['Home', 'Communications'],
      };
    }

    // Analytics & Reports
    if (path.includes('analytics') || path.includes('reports')) {
      return {
        title: 'Analytics & Reports',
        breadcrumbs: ['Home', 'Analytics'],
      };
    }

    // Daily Progress
    if (path.includes('daily-progress')) {
      return {
        title: 'Daily Progress',
        breadcrumbs: ['Home', 'Analytics', 'Daily Progress'],
      };
    }

    // Field App
    if (path.includes('field')) {
      return {
        title: 'Field App',
        breadcrumbs: ['Home', 'Field App'],
      };
    }

    // Deployment Health
    if (path.includes('deployment')) {
      return {
        title: 'Deployment Health',
        breadcrumbs: ['Home', 'System', 'Deployment Health'],
      };
    }

    // Settings
    if (path.includes('settings')) {
      return {
        title: 'Settings',
        breadcrumbs: ['Home', 'Settings'],
      };
    }

    // Action Items
    if (path.includes('action-items')) {
      return {
        title: 'Action Items',
        breadcrumbs: ['Home', 'Communications', 'Action Items'],
      };
    }

    // SOW Management
    if (path.includes('sow')) {
      return {
        title: 'SOW Management',
        breadcrumbs: ['Home', 'Project Management', 'SOW'],
      };
    }

    // Activate (DR QA)
    if (path.includes('activate')) {
      return {
        title: 'Activate',
        breadcrumbs: ['Home', 'Activate'],
      };
    }

    // NOC
    if (path.includes('noc')) {
      return {
        title: 'NOC',
        breadcrumbs: ['Home', 'NOC'],
      };
    }

    // Assets
    if (path.includes('assets')) {
      return {
        title: 'Asset Management',
        breadcrumbs: ['Home', 'Assets'],
      };
    }

    // Fleet
    if (path.includes('fleet')) {
      return {
        title: 'Fleet Management',
        breadcrumbs: ['Home', 'Fleet'],
      };
    }

    // Civil QA
    if (path.includes('civil') || path.includes('qfield')) {
      return {
        title: 'Civil QA',
        breadcrumbs: ['Home', 'Civil QA'],
      };
    }

    // Health & Safety
    if (path.includes('health-safety')) {
      return {
        title: 'Health & Safety',
        breadcrumbs: ['Home', 'Projects', 'Health & Safety'],
      };
    }

    // System Health
    if (path.includes('system-health') || path.includes('health')) {
      return {
        title: 'System Health',
        breadcrumbs: ['Home', 'System Health'],
      };
    }

    // Default
    return {
      title: 'FibreFlow',
      breadcrumbs: ['Home'],
    };
  };

  // Show loading spinner while user data is being fetched
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--ff-background-primary)]">
        <div className="text-center">
          <LoadingSpinner size="lg" className="mx-auto mb-4" />
          <p className="text-[var(--ff-text-secondary)]">Loading application...</p>
        </div>
      </div>
    );
  }

  const pageMeta = getPageMeta();
  const p = pathname || '';
  const isAccounting = p.startsWith('/accounting');
  const isProcurement = p.startsWith('/procurement');
  const isFleet = p.startsWith('/fleet');
  const isSOW = p.startsWith('/sow');
  const isAnalytics = ['/analytics', '/enhanced-kpis', '/kpi-dashboard', '/reports'].some(prefix => p.startsWith(prefix));
  const isSystem = ['/system', '/settings', '/deployment'].some(prefix => p.startsWith(prefix));

  return (
    <div className="flex h-screen bg-[var(--ff-background-primary)] overflow-hidden">
      {/* Impersonation Banner — only shown during admin impersonation sessions */}
      {currentUser?.isImpersonation && (
        <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 bg-orange-500 px-4 py-2 text-sm font-medium text-white shadow-lg">
          <svg
            className="h-4 w-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            Impersonating: {currentUser.displayName} ({currentUser.email}) — Close this tab to end session
          </span>
        </div>
      )}

      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-[var(--ff-surface-overlay)] lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className={`
        flex-1 flex flex-col min-w-0 transition-all duration-300
        ${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'}
      `}>
        {/* Header - hidden for pages with their own headers (e.g., project detail) */}
        {!hideHeader && (
          <Header
            title={pageMeta.title}
            breadcrumbs={pageMeta.breadcrumbs || ['Home']}
            actions={pageMeta.actions}
            onMenuClick={() => setSidebarOpen(true)}
            user={currentUser}
          />
        )}

        {/* Module sub-navigation (Sage-style tabs with dropdowns) */}
        {isAccounting && <AccountingNav />}
        {isProcurement && <ProcurementNav />}
        {isFleet && <FleetNav />}
        {isSOW && <SOWNav />}
        {isAnalytics && <AnalyticsNav />}
        {isSystem && <SystemNav />}

        {/* Page Content */}
        <main
          className={`flex-1 overflow-y-auto overflow-x-hidden bg-[var(--ff-background-primary)] relative z-10${currentUser?.isImpersonation ? ' pt-10' : ''}`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="min-h-full">
            {children}
          </div>
        </main>

        {/* Footer */}
        <Footer />
      </div>
      
      {/* Chat Widget - Available on all pages */}
      <ChatWidget
        userName={currentUser?.displayName || currentUser?.email?.split('@')[0]}
        userRole={currentUser?.role}
        userId={currentUser?.id}
      />

      {/* WebSocket Connection Status - Disabled */}
      {/* <ConnectionStatus
        mode="auto"
        position="bottom-right"
        showDetails={false}
        autoHide={true}
        autoHideDelay={5000}
      /> */}
    </div>
  );
}