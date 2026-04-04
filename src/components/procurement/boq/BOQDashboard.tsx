/**
 * BOQ Dashboard Component - Modular Implementation
 * Main management interface for BOQ operations
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { FileText, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';
import { BOQ, BOQStats } from '@/types/procurement/boq.types';
import { ImportJob, ImportStats } from '@/services/procurement/boqImportService';
import { useProcurementContext } from '@/hooks/procurement/useProcurementContext';
import { notificationService } from '@/services/core/NotificationService';

// Import split components
import BOQUpload from './BOQUpload';
import BOQList from './BOQList';
import BOQViewer from './BOQViewer';
import BOQMappingReview from './BOQMappingReview';
import BOQHistory from './BOQHistory';
import BOQNavigationBreadcrumb from './dashboard/BOQNavigationBreadcrumb';
import BOQOverview from './dashboard/BOQOverview';

// Import utilities and services
import { DashboardView, RecentActivity, BOQDashboardProps } from './dashboard/BOQDashboardTypes';
import { getStatusColor, formatRelativeTime } from './dashboard/BOQDashboardUtils';
import { BOQDataLoader } from './dashboard/BOQDataLoader';

export default function BOQDashboard({ className }: BOQDashboardProps) {
  const { context } = useProcurementContext();
  const [currentView, setCurrentView] = useState<DashboardView>('overview');
  const [selectedBOQ, setSelectedBOQ] = useState<BOQ | null>(null);
  const [stats, setStats] = useState<BOQStats | null>(null);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [recentBOQs, setRecentBOQs] = useState<BOQ[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [activeJobs, setActiveJobs] = useState<ImportJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create data loader instance (memoized to prevent recreating on every render)
  const dataLoader = useMemo(() => new BOQDataLoader(), []);

  const loadDashboardData = useCallback(async () => {
    if (!context) return;

    try {
      setIsLoading(true);
      
      // Load all dashboard data
      const data = await dataLoader.loadAllDashboardData(context);
      
      setStats(data.boqStats);
      setImportStats(data.importStats);
      setRecentBOQs(data.recentBOQs);
      setRecentActivity(data.recentActivity);
      setActiveJobs(data.activeJobs);
    } catch (error) {
      log.error('Failed to load dashboard data:', { data: error }, 'BOQDashboard');
      notificationService.operationError('load', error as Error, 'dashboard data');
    } finally {
      setIsLoading(false);
    }
  }, [context, dataLoader]);

  const loadActiveJobs = useCallback(() => {
    const jobs = dataLoader.getActiveJobs();
    setActiveJobs(jobs);
  }, [dataLoader]);

  // Load dashboard data
  useEffect(() => {
    if (currentView === 'overview') {
      loadDashboardData();
    }
  }, [currentView, context, loadDashboardData]);

  // Refresh active jobs periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentView === 'overview') {
        loadActiveJobs();
      }
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, [currentView, loadActiveJobs]);

  // Handle view navigation
  const navigateToView = (view: DashboardView, boq?: BOQ) => {
    setCurrentView(view);
    if (boq) {
      setSelectedBOQ(boq);
    }
  };

  // Handle upload completion
  const handleUploadComplete = (result: { boqId: string; itemsCreated: number; exceptionsCreated: number }) => {
    notificationService.success(`BOQ imported successfully! ${result.itemsCreated} items created`);
    loadDashboardData(); // Refresh data
    
    // Navigate to mapping review if there are exceptions
    if (result.exceptionsCreated > 0) {
      setSelectedBOQ({ id: result.boqId } as BOQ);
      setCurrentView('mapping');
    }
  };


  // Render different views
  const renderView = () => {
    switch (currentView) {
      case 'upload':
        return (
          <BOQUpload
            onUploadComplete={handleUploadComplete}
            onUploadError={(error) => notificationService.error(error)}
          />
        );
      
      case 'list':
        return (
          <BOQList
            onSelectBOQ={(boq) => navigateToView('viewer', boq)}
            onCreateBOQ={() => navigateToView('upload')}
            onUploadBOQ={() => navigateToView('upload')}
            selectedBOQId={selectedBOQ?.id || ''}
          />
        );
      
      case 'viewer':
        return selectedBOQ ? (
          <BOQViewer
            boqId={selectedBOQ.id}
            onBOQUpdate={(updatedBOQ) => {
              setSelectedBOQ(updatedBOQ);
              loadDashboardData();
            }}
          />
        ) : (
          <div className="text-center py-12">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-foreground">No BOQ Selected</h3>
            <p className="mt-2 text-sm text-muted-foreground">Please select a BOQ to view.</p>
          </div>
        );
      
      case 'mapping':
        return selectedBOQ ? (
          <BOQMappingReview
            boqId={selectedBOQ.id}
            onMappingComplete={() => loadDashboardData()}
            onClose={() => setCurrentView('overview')}
          />
        ) : (
          <div className="text-center py-12">
            <AlertTriangle className="mx-auto h-12 w-12 text-orange-400" />
            <h3 className="mt-4 text-lg font-medium text-foreground">No BOQ Selected</h3>
            <p className="mt-2 text-sm text-muted-foreground">Please select a BOQ for mapping review.</p>
          </div>
        );
      
      case 'history':
        return selectedBOQ ? (
          <BOQHistory
            boqId={selectedBOQ.id}
            onVersionSelect={(version) => {
              notificationService.info(`Viewing version ${version.version}`);
            }}
            onRestore={() => loadDashboardData()}
          />
        ) : (
          <div className="text-center py-12">
            <Clock className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-foreground">No BOQ Selected</h3>
            <p className="mt-2 text-sm text-muted-foreground">Please select a BOQ to view its history.</p>
          </div>
        );
      
      default:
        return (
          <BOQOverview
            stats={stats}
            importStats={importStats}
            recentBOQs={recentBOQs}
            recentActivity={recentActivity}
            activeJobs={activeJobs}
            isLoading={isLoading}
            onUpload={() => setCurrentView('upload')}
            onViewList={() => setCurrentView('list')}
            onViewAnalytics={() => {/* Generate report */}}
            onExport={() => {/* Export data */}}
            onSelectBOQ={(boq) => navigateToView('viewer', boq)}
            formatRelativeTime={formatRelativeTime}
            getStatusColor={getStatusColor}
          />
        );
    }
  };

  if (isLoading && currentView === 'overview') {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-muted-foreground">Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Navigation Breadcrumb */}
      <BOQNavigationBreadcrumb
        currentView={currentView}
        onViewChange={setCurrentView}
        onRefresh={loadDashboardData}
      />

      {/* Main Content */}
      {renderView()}
    </div>
  );
}