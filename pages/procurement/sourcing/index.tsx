/**
 * Sourcing Page - Unified tab interface for pre-purchase activities
 * Tabs: Suppliers | BOQ | RFQ
 */

import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { AppLayout } from '@/components/layout';
import { useTabPersistence } from '@/modules/procurement/hooks';
import {
  ShoppingCart,
  Truck,
  FileSpreadsheet,
  FileQuestion,
} from 'lucide-react';

// Content components
import { SuppliersPage } from '@/modules/suppliers/SuppliersPage';
import BOQList from '@/components/procurement/boq/BOQList';
import RFQList from '@/components/procurement/rfq/RFQList';

interface SourcingPageProps {
  projectId?: string;
  projectName?: string;
}

const TABS = [
  { id: 'suppliers', label: 'Suppliers', icon: Truck },
  { id: 'boq', label: 'BOQ', icon: FileSpreadsheet },
  { id: 'rfq', label: 'RFQ', icon: FileQuestion },
] as const;

type TabId = typeof TABS[number]['id'];

export default function SourcingPage({ projectId, projectName }: SourcingPageProps) {
  const router = useRouter();

  const { activeTab, changeTab, isInitialized } = useTabPersistence({
    pageKey: 'sourcing',
    defaultTab: 'suppliers',
    validTabs: TABS.map(t => t.id),
  });

  const handleCreateBOQ = () => {
    router.push('/procurement/boq/new');
  };

  const handleCreateRFQ = () => {
    router.push('/procurement/rfq/new');
  };

  const handleViewRFQ = (id: string) => {
    router.push(`/procurement/rfq/${id}`);
  };

  const handleEditRFQ = (id: string) => {
    router.push(`/procurement/rfq/${id}/edit`);
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Page Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <ShoppingCart className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  Sourcing
                </h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Manage suppliers, bill of quantities, and requests for quotes
                </p>
              </div>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="px-6">
            <nav className="flex gap-1" aria-label="Sourcing tabs">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => changeTab(tab.id)}
                    className={`
                      flex items-center gap-2 px-4 py-3 text-sm font-medium
                      border-b-2 transition-colors
                      ${isActive
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-secondary)]'
                      }
                    `}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {!isInitialized ? (
            <div className="flex justify-center items-center h-64">
              <div className="text-[var(--ff-text-secondary)]">Loading...</div>
            </div>
          ) : (
            <>
              {activeTab === 'suppliers' && (
                <SuppliersPage />
              )}

              {activeTab === 'boq' && (
                <BOQList
                  onCreateBOQ={handleCreateBOQ}
                  projectId={projectId}
                />
              )}

              {activeTab === 'rfq' && (
                <div className="space-y-6">
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                      Request for Quotes
                    </h2>
                    {projectName && (
                      <p className="text-sm text-[var(--ff-text-secondary)]">
                        Project: {projectName}
                      </p>
                    )}
                  </div>
                  <RFQList
                    rfqs={[]}
                    onCreateRFQ={handleCreateRFQ}
                    onView={handleViewRFQ}
                    onEdit={handleEditRFQ}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { query } = context;
  const projectId = query.projectId as string | undefined;
  const projectName = query.projectName as string | undefined;

  return {
    props: {
      projectId: projectId || null,
      projectName: projectName || null,
    },
  };
};
