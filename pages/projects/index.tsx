/**
 * Projects Landing Page (PRD-058)
 * Main projects page with Overview (Dashboard) and All Projects tabs
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { PortfolioDashboard } from '@/modules/projects/components/Dashboard';
import { ProjectList } from '@/modules/projects/components/ProjectList';
import {
  LayoutDashboard,
  FolderKanban,
  Plus,
  FileBarChart2,
} from 'lucide-react';

type TabId = 'overview' | 'all' | 'reports';

interface TabConfig {
  id: TabId;
  label: string;
  icon: React.ElementType;
  href?: string;
}

const tabs: TabConfig[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'all', label: 'All Projects', icon: FolderKanban },
  { id: 'reports', label: 'Reports', icon: FileBarChart2, href: '/projects/reports' },
];

export default function ProjectsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // Sync tab from URL
  useEffect(() => {
    const tab = router.query.tab as TabId;
    if (tab && tabs.some(t => t.id === tab)) {
      setActiveTab(tab);
    }
  }, [router.query.tab]);

  // Update URL when tab changes
  const handleTabChange = (tab: TabConfig) => {
    // If tab has a dedicated href, navigate there
    if (tab.href) {
      router.push(tab.href);
      return;
    }

    setActiveTab(tab.id);
    router.push(
      { pathname: '/projects', query: tab.id === 'overview' ? {} : { tab: tab.id } },
      undefined,
      { shallow: true }
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
              Projects
            </h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Manage and track your fiber network projects
            </p>
          </div>
          <Link
            href="/projects/new"
            className="ff-button ff-button--primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Project
          </Link>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--ff-border-light)]">
          <nav className="flex gap-1 -mb-px" aria-label="Projects navigation">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab)}
                  className={`
                    flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                    ${isActive
                      ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-default)]'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="min-h-[500px]">
          {activeTab === 'overview' && (
            <PortfolioDashboard />
          )}

          {activeTab === 'all' && (
            <ProjectList />
          )}

          {activeTab === 'reports' && (
            <div className="ff-card text-center py-12">
              <FileBarChart2 className="w-12 h-12 mx-auto text-[var(--ff-text-secondary)] mb-4" />
              <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
                Reports Coming Soon
              </h3>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Project analytics and reporting features are under development.
              </p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
