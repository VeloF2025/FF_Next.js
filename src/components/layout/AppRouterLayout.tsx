'use client';

import { useState, useEffect, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Footer } from './Footer';

interface PageMeta {
  title: string;
  breadcrumbs?: string[];
  actions?: React.ReactNode;
}

interface AppRouterLayoutProps {
  children: ReactNode;
}

export function AppRouterLayout({ children }: AppRouterLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Initialize with false to match SSR - load from localStorage in useEffect
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const pathname = usePathname();
  const { currentUser, loading } = useAuth();

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

  // Get page metadata based on current route
  const getPageMeta = (): PageMeta => {
    const segments = pathname.split('/').filter(Boolean);

    // Contractors
    if (pathname.includes('contractors')) {
      if (segments.includes('new')) {
        return {
          title: 'Add Contractor',
          breadcrumbs: ['Home', 'Contractors', 'Add'],
        };
      }
      if (segments.includes('rag-dashboard')) {
        return {
          title: 'RAG Dashboard',
          breadcrumbs: ['Home', 'Contractors'],
        };
      }
      if (segments.length > 1) {
        return {
          title: 'Contractor Details',
          breadcrumbs: ['Home', 'Contractors', 'Details'],
        };
      }
      return {
        title: 'Contractors',
        breadcrumbs: ['Home', 'Contractors'],
      };
    }

    // WA Monitor
    if (pathname.includes('wa-monitor')) {
      if (pathname.includes('dr-validation')) {
        return {
          title: 'DR Validation',
          breadcrumbs: ['Home', 'QA', 'WhatsApp Monitor'],
        };
      }
      return {
        title: 'WhatsApp Monitor',
        breadcrumbs: ['Home', 'QA'],
      };
    }

    // Downloads
    if (pathname.includes('downloads')) {
      return {
        title: 'Downloads',
        breadcrumbs: ['Home', 'Downloads'],
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

  return (
    <div className="flex h-screen bg-[var(--ff-background-secondary)] overflow-hidden">
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
        {/* Header */}
        <Header
          title={pageMeta.title}
          breadcrumbs={pageMeta.breadcrumbs || ['Home']}
          actions={pageMeta.actions}
          onMenuClick={() => setSidebarOpen(true)}
          user={currentUser}
        />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-[var(--ff-background-primary)]">
          <div className="min-h-full">
            {children}
          </div>
        </main>

        {/* Footer */}
        <Footer />
      </div>
    </div>
  );
}
