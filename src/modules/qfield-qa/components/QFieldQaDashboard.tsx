/**
 * QField QA Dashboard
 * Main dashboard for QField photo validation and QA workflow
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Chip,
} from '@mui/material';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  User,
  Camera,
} from 'lucide-react';
import { useQFieldQa } from '../hooks/useQFieldQa';
import { OverviewTab } from './OverviewTab';
import { PhotoListTab } from './PhotoListTab';
import { PhotoDetailModal } from './PhotoDetailModal';
import type { PhotoValidation, QAFilters } from '../types';
import { log } from '@/lib/logger';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`qa-tabpanel-${index}`}
      aria-labelledby={`qa-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

export function QFieldQaDashboard() {
  const [activeTab, setActiveTab] = useState(0);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoValidation | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<string>('');

  const {
    validations,
    stats,
    projects,
    pagination,
    filters,
    loading,
    error,
    lastRefresh,
    refresh,
    executeAction,
    triggerValidation,
    assignPhotos,
    updateFilters,
    clearFilters,
    setPage,
  } = useQFieldQa({ autoRefresh: true, refreshInterval: 30000 });

  // Get current user from auth context or session
  useEffect(() => {
    // This would normally come from your auth context
    // For now, using a placeholder
    setCurrentUser(localStorage.getItem('userEmail') || '');
  }, []);

  // My queue count
  const myQueueCount = useMemo(() => {
    if (!currentUser || !validations) return 0;
    return validations.filter(v => v.assigned_to === currentUser).length;
  }, [currentUser, validations]);

  // Handle tab change
  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    // Update filters based on tab
    if (newValue === 1) {
      // My Queue tab
      updateFilters({ assignedTo: currentUser, workflowStatus: 'in_review' });
    } else if (newValue === 2) {
      // All Photos tab
      clearFilters();
    } else {
      // Overview tab
      clearFilters();
    }
  };

  // Handle photo click
  const handlePhotoClick = (photo: PhotoValidation) => {
    setSelectedPhoto(photo);
  };

  // Handle selection change
  const handleSelectionChange = (ids: string[]) => {
    setSelectedIds(ids);
  };

  // Handle approve
  const handleApprove = async (ids: string[], notes?: string) => {
    try {
      await executeAction('approve', ids, { notes });
      setSelectedIds([]);
      setSelectedPhoto(null);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'approve', error: err }, 'Approve failed');
    }
  };

  // Handle reject
  const handleReject = async (ids: string[], notes?: string) => {
    try {
      await executeAction('reject', ids, { notes });
      setSelectedIds([]);
      setSelectedPhoto(null);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'reject', error: err }, 'Reject failed');
    }
  };

  // Handle escalate
  const handleEscalate = async (ids: string[], reason: string) => {
    try {
      await executeAction('escalate', ids, { escalationReason: reason });
      setSelectedIds([]);
      setSelectedPhoto(null);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'escalate', error: err }, 'Escalate failed');
    }
  };

  // Handle re-validate
  const handleRevalidate = async (ids: string[]) => {
    try {
      await triggerValidation(ids);
      setSelectedIds([]);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'revalidate', error: err }, 'Revalidate failed');
    }
  };

  // Handle assign
  const handleAssign = async (ids: string[], assignee: string, options?: { dueDate?: string; priority?: string }) => {
    try {
      await assignPhotos(ids, assignee, options);
      setSelectedIds([]);
    } catch (err) {
      log.error('QFieldQaDashboard', { action: 'assign', error: err }, 'Assign failed');
    }
  };

  if (loading && !validations.length) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600 }}>
            QField QA
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Photo validation and quality assurance
            {lastRefresh && (
              <span style={{ marginLeft: 16 }}>
                Last updated: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </Box>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      {stats && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} sm={4} md={2}>
            <Card sx={{ bgcolor: 'background.default' }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Clock className="w-6 h-6 mx-auto mb-1 text-yellow-500" />
                <Typography variant="h5" fontWeight="bold">
                  {stats.summary.pending}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Pending
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card sx={{ bgcolor: 'background.default' }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <User className="w-6 h-6 mx-auto mb-1 text-blue-500" />
                <Typography variant="h5" fontWeight="bold">
                  {stats.summary.in_review}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  In Review
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card sx={{ bgcolor: 'background.default' }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <CheckCircle className="w-6 h-6 mx-auto mb-1 text-green-500" />
                <Typography variant="h5" fontWeight="bold">
                  {stats.summary.approved}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Approved
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card sx={{ bgcolor: 'background.default' }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <XCircle className="w-6 h-6 mx-auto mb-1 text-red-500" />
                <Typography variant="h5" fontWeight="bold">
                  {stats.summary.rejected}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Rejected
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card sx={{ bgcolor: 'background.default' }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <AlertTriangle className="w-6 h-6 mx-auto mb-1 text-orange-500" />
                <Typography variant="h5" fontWeight="bold">
                  {stats.summary.escalated}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Escalated
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <Card sx={{ bgcolor: 'background.default' }}>
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Camera className="w-6 h-6 mx-auto mb-1 text-purple-500" />
                <Typography variant="h5" fontWeight="bold">
                  {stats.summary.needs_retake}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Needs Retake
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab label="Overview" />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                My Queue
                {myQueueCount > 0 && (
                  <Chip label={myQueueCount} size="small" color="primary" />
                )}
              </Box>
            }
          />
          <Tab label="All Photos" />
        </Tabs>
      </Box>

      {/* Tab Content */}
      <TabPanel value={activeTab} index={0}>
        <OverviewTab
          stats={stats}
          recentActivity={stats?.recent_activity || []}
          onViewAll={() => setActiveTab(2)}
        />
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        <PhotoListTab
          validations={validations.filter(v => v.assigned_to === currentUser)}
          projects={projects}
          filters={filters}
          pagination={pagination}
          loading={loading}
          selectedIds={selectedIds}
          onFilterChange={updateFilters}
          onPageChange={setPage}
          onPhotoClick={handlePhotoClick}
          onSelectionChange={handleSelectionChange}
          onApprove={handleApprove}
          onReject={handleReject}
          onEscalate={handleEscalate}
          onRevalidate={handleRevalidate}
          onAssign={handleAssign}
        />
      </TabPanel>

      <TabPanel value={activeTab} index={2}>
        <PhotoListTab
          validations={validations}
          projects={projects}
          filters={filters}
          pagination={pagination}
          loading={loading}
          selectedIds={selectedIds}
          onFilterChange={updateFilters}
          onPageChange={setPage}
          onPhotoClick={handlePhotoClick}
          onSelectionChange={handleSelectionChange}
          onApprove={handleApprove}
          onReject={handleReject}
          onEscalate={handleEscalate}
          onRevalidate={handleRevalidate}
          onAssign={handleAssign}
        />
      </TabPanel>

      {/* Photo Detail Modal */}
      {selectedPhoto && (
        <PhotoDetailModal
          photo={selectedPhoto}
          open={!!selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          onApprove={(notes) => handleApprove([selectedPhoto.id], notes)}
          onReject={(notes) => handleReject([selectedPhoto.id], notes)}
          onEscalate={(reason) => handleEscalate([selectedPhoto.id], reason)}
          onRevalidate={() => handleRevalidate([selectedPhoto.id])}
        />
      )}
    </Box>
  );
}

export default QFieldQaDashboard;
