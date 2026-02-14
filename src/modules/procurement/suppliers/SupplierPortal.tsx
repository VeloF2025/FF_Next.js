import { useState, Suspense } from 'react';
import { useOutletContext } from 'react-router-dom';
import { 
  Building2,
  TrendingUp,
  MessageCircle,
  UserPlus,
  Settings,
  FileText,
  type LucideIcon
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { ProcurementPortalContext } from '@/types/procurement/portal.types';

// Import components - TODO: Implement these components
// import SupplierRegistry from './components/SupplierRegistry';
// import PerformanceDashboard from './components/PerformanceDashboard';
// import CommunicationCenter from './components/CommunicationCenter';
// import SelfServicePortal from './components/SelfServicePortal';
// import SupplierOnboarding from './components/SupplierOnboarding';

// Placeholder components - TODO: Replace with actual implementations
const SupplierRegistry = () => (
  <div className="p-6">
    <h3 className="text-lg font-semibold mb-4">Supplier Registry</h3>
    <p className="text-muted-foreground">Component under development - Supplier profile management coming soon.</p>
  </div>
);

const PerformanceDashboard = () => (
  <div className="p-6">
    <h3 className="text-lg font-semibold mb-4">Performance Dashboard</h3>
    <p className="text-muted-foreground">Component under development - Supplier performance analytics coming soon.</p>
  </div>
);

const CommunicationCenter = () => (
  <div className="p-6">
    <h3 className="text-lg font-semibold mb-4">Communication Center</h3>
    <p className="text-muted-foreground">Component under development - Supplier communications coming soon.</p>
  </div>
);

const SelfServicePortal = () => (
  <div className="p-6">
    <h3 className="text-lg font-semibold mb-4">Self-Service Portal</h3>
    <p className="text-muted-foreground">Component under development - Supplier self-service features coming soon.</p>
  </div>
);

const SupplierOnboarding = () => (
  <div className="p-6">
    <h3 className="text-lg font-semibold mb-4">Supplier Onboarding</h3>
    <p className="text-muted-foreground">Component under development - Supplier onboarding workflow coming soon.</p>
  </div>
);

type TabKey = 'registry' | 'performance' | 'communications' | 'self-service' | 'onboarding';

interface TabConfig {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  component: React.ComponentType;
  description: string;
  requiresPermission?: string;
}

const tabs: TabConfig[] = [
  {
    key: 'registry',
    label: 'Supplier Registry',
    icon: Building2,
    component: SupplierRegistry,
    description: 'Manage supplier profiles, documents, and compliance',
    requiresPermission: 'canManageSuppliers'
  },
  {
    key: 'performance',
    label: 'Performance Dashboard',
    icon: TrendingUp,
    component: PerformanceDashboard,
    description: 'Track supplier scorecards, ratings, and KPIs'
  },
  {
    key: 'communications',
    label: 'Communication Center',
    icon: MessageCircle,
    component: CommunicationCenter,
    description: 'RFQ invitations, Q&A management, and messaging'
  },
  {
    key: 'self-service',
    label: 'Self-Service Portal',
    icon: Settings,
    component: SelfServicePortal,
    description: 'Supplier portal for quote submissions and PO management'
  },
  {
    key: 'onboarding',
    label: 'Supplier Onboarding',
    icon: UserPlus,
    component: SupplierOnboarding,
    description: 'Registration and onboarding process for new suppliers',
    requiresPermission: 'canManageSuppliers'
  }
];

export default function SupplierPortal() {
  const portalContext = useOutletContext<ProcurementPortalContext>();
  const { selectedProject, permissions } = portalContext || {};
  const [activeTab, setActiveTab] = useState<TabKey>('registry');

  // Filter tabs based on permissions
  const availableTabs = tabs.filter(tab => {
    if (!tab.requiresPermission) return true;
    return permissions?.[tab.requiresPermission as keyof typeof permissions];
  });

  const currentTab = availableTabs.find(tab => tab.key === activeTab);

  if (!currentTab) {
    return (
      <div className="p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <FileText className="h-5 w-5 text-yellow-600 mr-2" />
            <div>
              <h3 className="text-sm font-medium text-yellow-800">
                Access Restricted
              </h3>
              <p className="text-sm text-yellow-700 mt-1">
                You don't have permission to access this section. Contact your administrator for access.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleTabChange = (tabKey: TabKey) => {
    setActiveTab(tabKey);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Supplier Portal</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Comprehensive supplier relationship management and portal access
            </p>
          </div>
          
          {selectedProject && (
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Project Context</p>
              <p className="text-sm font-medium text-foreground">{selectedProject.name}</p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="bg-card border-b border-border">
        <div className="px-6">
          <nav className="flex space-x-8" aria-label="Tabs">
            {availableTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              
              return (
                <button
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={`
                    flex items-center py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap
                    transition-colors duration-200
                    ${isActive
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-muted-foreground hover:text-muted-foreground hover:border-border'
                    }
                  `}
                >
                  <Icon className="h-5 w-5 mr-2" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab Description */}
      <div className="bg-background border-b border-border px-6 py-3">
        <p className="text-sm text-muted-foreground">{currentTab.description}</p>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        <Suspense 
          fallback={
            <div className="flex items-center justify-center h-full">
              <LoadingSpinner size="lg" />
            </div>
          }
        >
          <currentTab.component />
        </Suspense>
      </div>
    </div>
  );
}

// Export tab configuration for route setup if needed
export { tabs, type TabKey, type TabConfig };