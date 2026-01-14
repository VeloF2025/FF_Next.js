/**
 * WA Monitor Dashboard Component
 * Main dashboard for WhatsApp QA drop monitoring
 * Features: Auto-refresh, summary cards, data grid, export
 */

'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import { Alert, Button, Card, CardContent, Grid, Typography, Box, CircularProgress, Pagination, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';
import { RefreshCw, Download, AlertCircle, Calendar } from 'lucide-react';
import { fetchAllDrops, sendFeedbackToWhatsApp, fetchDailyDropsPerProject } from '../services/waMonitorApiService';
import { downloadCSV } from '../utils/waMonitorHelpers';
import { QaReviewCard } from './QaReviewCard';
import { WaMonitorFilters, type FilterState } from './WaMonitorFilters';
import type { QaReviewDrop, WaMonitorSummary, DailyDropsPerProject } from '../types/wa-monitor.types';
import { UnifiedReviewCard } from '@/modules/dr-photo-unified/components/UnifiedReviewCard';
import { isUnifiedReviewEnabled } from '@/lib/featureFlags';

const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds
const ITEMS_PER_PAGE = 20; // Show 20 drops per page

export function WaMonitorDashboard() {
  const [drops, setDrops] = useState<QaReviewDrop[]>([]);
  const [summary, setSummary] = useState<WaMonitorSummary | null>(null);
  const [dailyDrops, setDailyDrops] = useState<{ drops: DailyDropsPerProject[]; total: number; date: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filters, setFilters] = useState<FilterState>({ status: 'all', searchTerm: '', resubmitted: 'all', project: undefined, dateFrom: undefined, dateTo: undefined });
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch data function
  const fetchData = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);

      // Fetch both regular drops and daily drops in parallel
      const [
        { drops: fetchedDrops, summary: fetchedSummary },
        dailyDropsData
      ] = await Promise.all([
        fetchAllDrops(),
        fetchDailyDropsPerProject()
      ]);

      // Only update drops that aren't currently being edited (locked by current user)
      // This prevents overwriting active edits during auto-refresh
      setDrops((prevDrops) => {
        if (prevDrops.length === 0) {
          // First load - use all fetched drops
          return fetchedDrops;
        }

        return fetchedDrops.map(newDrop => {
          // Find existing drop
          const existingDrop = prevDrops.find(d => d.id === newDrop.id);

          // If drop is locked by current user, keep old data (don't overwrite edits)
          // Note: currentUser would need to be passed from QaReviewCard or auth context
          if (existingDrop?.lockedBy && existingDrop.lockedBy === 'Louis Duplessis') {
            return existingDrop;
          }

          // Otherwise use new data
          return newDrop;
        });
      });

      setSummary(fetchedSummary || null);
      setDailyDrops(dailyDropsData);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Error fetching drops:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch drops');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(false); // Don't show loading spinner for auto-refresh
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  // Manual refresh handler
  const handleRefresh = () => {
    fetchData();
  };

  // Export handler - exports only filtered drops
  const handleExport = () => {
    // Generate filename with date range if applicable
    let filename = 'wa-monitor-drops';
    if (filters.dateFrom && filters.dateTo) {
      const fromStr = new Date(filters.dateFrom).toISOString().split('T')[0];
      const toStr = new Date(filters.dateTo).toISOString().split('T')[0];
      filename += `_${fromStr}_to_${toStr}`;
    } else if (filters.dateFrom) {
      const dateStr = new Date(filters.dateFrom).toISOString().split('T')[0];
      filename += `_from_${dateStr}`;
    } else if (filters.dateTo) {
      const dateStr = new Date(filters.dateTo).toISOString().split('T')[0];
      filename += `_until_${dateStr}`;
    }
    if (filters.project && filters.project !== 'all') {
      filename += `_${filters.project}`;
    }
    filename += '.csv';

    downloadCSV(filteredDrops, filename);
  };

  // Handle drop update
  const handleDropUpdate = async (dropId: string, updates: Partial<QaReviewDrop>) => {
    try {
      // Call API to update drop
      const response = await fetch(`/api/wa-monitor-drops/${dropId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error('Failed to update drop');

      // Refresh data
      await fetchData(false);
    } catch (error) {
      console.error('Error updating drop:', error);
      throw error;
    }
  };

  // Handle send feedback - sends to WhatsApp and updates database
  const handleSendFeedback = async (dropId: string, dropNumber: string, message: string, project?: string) => {
    try {
      // Send feedback to WhatsApp group (defaults to Velo Test for testing)
      const result = await sendFeedbackToWhatsApp(dropId, dropNumber, message, project);

      if (!result.success) {
        throw new Error(result.message || 'Failed to send feedback');
      }

      console.log('✅ Feedback sent:', result.message);

      // Refresh data to show updated feedback_sent timestamp
      await fetchData(false);
    } catch (error) {
      console.error('Error sending feedback:', error);
      throw error;
    }
  };

  // Get unique projects from drops
  const availableProjects = useMemo(() => {
    const projects = drops
      .map((drop) => drop.project)
      .filter((project): project is string => project !== null && project !== undefined && project !== '');
    return Array.from(new Set(projects)).sort();
  }, [drops]);

  // Filter drops based on current filters
  const filteredDrops = useMemo(() => {
    return drops.filter((drop) => {
      // Filter by date from (inclusive)
      if (filters.dateFrom) {
        const dropDate = new Date(drop.createdAt);
        const filterDate = new Date(filters.dateFrom);
        // Set time to start of day for accurate comparison
        dropDate.setHours(0, 0, 0, 0);
        filterDate.setHours(0, 0, 0, 0);

        if (dropDate < filterDate) {
          return false;
        }
      }

      // Filter by date to (inclusive)
      if (filters.dateTo) {
        const dropDate = new Date(drop.createdAt);
        const filterDate = new Date(filters.dateTo);
        // Set time to end of day for accurate comparison
        dropDate.setHours(0, 0, 0, 0);
        filterDate.setHours(23, 59, 59, 999);

        if (dropDate > filterDate) {
          return false;
        }
      }

      // Filter by status
      if (filters.status !== 'all' && drop.status !== filters.status) {
        return false;
      }

      // Filter by resubmitted
      if (filters.resubmitted && filters.resubmitted !== 'all') {
        if (filters.resubmitted === 'resubmitted' && !drop.resubmitted) {
          return false;
        }
        if (filters.resubmitted === 'not_resubmitted' && drop.resubmitted) {
          return false;
        }
      }

      // Filter by project
      if (filters.project && filters.project !== 'all') {
        if (drop.project !== filters.project) {
          return false;
        }
      }

      // Filter by search term (drop number)
      if (filters.searchTerm) {
        const searchLower = filters.searchTerm.toLowerCase();
        return drop.dropNumber.toLowerCase().includes(searchLower);
      }

      return true;
    });
  }, [drops, filters]);

  // Calculate summary stats from filtered drops
  const calculatedSummary = useMemo<WaMonitorSummary>(() => {
    const total = filteredDrops.length;
    const incomplete = filteredDrops.filter(d => d.incomplete).length;
    const complete = filteredDrops.filter(d => d.completed).length;  // Fixed: was d.complete, should be d.completed
    const totalFeedback = filteredDrops.filter(d => d.completed || d.incomplete).length;  // Fixed: count all reviewed drops (complete OR incomplete)

    return {
      total,
      incomplete,
      complete,
      totalFeedback
    };
  }, [filteredDrops]);

  // Paginate filtered drops
  const paginatedDrops = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredDrops.slice(startIndex, endIndex);
  }, [filteredDrops, currentPage]);

  // Calculate total pages
  const totalPages = Math.ceil(filteredDrops.length / ITEMS_PER_PAGE);

  // Handle filter change
  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
    setCurrentPage(1); // Reset to page 1 when filters change
  };

  // Handle page change
  const handlePageChange = (_event: React.ChangeEvent<unknown>, page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll to top on page change
  };

  return (
    <div className="space-y-6 p-6">
      {/* Action buttons and refresh info */}
      <div className="flex items-center justify-between">
        <div>
          {lastRefresh && (
            <Typography variant="caption" color="textSecondary">
              Last updated: {lastRefresh.toLocaleTimeString()} (Auto-refresh every 30s)
            </Typography>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outlined"
            startIcon={<RefreshCw size={18} />}
            onClick={handleRefresh}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<Download size={18} />}
            onClick={handleExport}
            disabled={filteredDrops.length === 0}
          >
            Export CSV ({filteredDrops.length})
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" icon={<AlertCircle size={20} />}>
          {error}
        </Alert>
      )}

      {/* Summary Cards - Now showing filtered totals */}
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'var(--ff-bg-secondary)', color: 'var(--ff-text-primary)' }}>
            <CardContent>
              <Typography sx={{ color: 'var(--ff-text-secondary)' }} gutterBottom variant="body2">
                Total Drops
              </Typography>
              <Typography variant="h4" component="div" sx={{ color: 'var(--ff-text-primary)' }}>
                {calculatedSummary.total}
              </Typography>
              {(filters.dateFrom || filters.dateTo) && (
                <Typography variant="caption" sx={{ color: 'var(--ff-text-secondary)' }}>
                  {filters.dateFrom && filters.dateTo
                    ? `${new Date(filters.dateFrom).toLocaleDateString()} - ${new Date(filters.dateTo).toLocaleDateString()}`
                    : filters.dateFrom
                    ? `From ${new Date(filters.dateFrom).toLocaleDateString()}`
                    : `Until ${new Date(filters.dateTo!).toLocaleDateString()}`}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'var(--ff-bg-secondary)', color: 'var(--ff-text-primary)' }}>
            <CardContent>
              <Typography sx={{ color: 'var(--ff-text-secondary)' }} gutterBottom variant="body2">
                Incomplete
              </Typography>
              <Typography variant="h4" component="div" color="error">
                {calculatedSummary.incomplete}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'var(--ff-bg-secondary)', color: 'var(--ff-text-primary)' }}>
            <CardContent>
              <Typography sx={{ color: 'var(--ff-text-secondary)' }} gutterBottom variant="body2">
                Complete
              </Typography>
              <Typography variant="h4" component="div" color="success.main">
                {calculatedSummary.complete}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: 'var(--ff-bg-secondary)', color: 'var(--ff-text-primary)' }}>
            <CardContent>
              <Typography sx={{ color: 'var(--ff-text-secondary)' }} gutterBottom variant="body2">
                Total Feedback
              </Typography>
              <Typography variant="h4" component="div" sx={{ color: 'var(--ff-text-primary)' }}>
                {calculatedSummary.totalFeedback}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Daily Drops Per Project */}
      {dailyDrops && dailyDrops.drops.length > 0 && (
        <Card sx={{ bgcolor: 'var(--ff-bg-secondary)', color: 'var(--ff-text-primary)' }}>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
              <Box display="flex" alignItems="center" gap={1}>
                <Calendar size={20} />
                <Typography variant="h6" component="h2" sx={{ color: 'var(--ff-text-primary)' }}>
                  Today's Submissions ({dailyDrops.date})
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: 'var(--ff-text-secondary)' }}>
                Auto-syncs to SharePoint daily at 8pm SAST
              </Typography>
            </Box>

            {/* Informational Note about Data Accuracy */}
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Accurate Daily Counts:</strong> Shows submissions by actual WhatsApp message date, not database processing time.
              </Typography>
              <Typography variant="caption" sx={{ color: 'var(--ff-text-secondary)' }}>
                Note: Historical batch processing (e.g., old messages processed today) are excluded from today's count.
                Only drops submitted via WhatsApp <strong>today</strong> are shown. Previous issue where 27 historical drops
                inflated the count has been resolved (Nov 6, 2025).
              </Typography>
            </Alert>

            <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: 'var(--ff-bg-tertiary)' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: 'var(--ff-text-primary)', borderColor: 'var(--ff-border-light)' }}><strong>Project</strong></TableCell>
                    <TableCell align="right" sx={{ color: 'var(--ff-text-primary)', borderColor: 'var(--ff-border-light)' }}><strong>Drops Submitted</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dailyDrops.drops.map((item) => (
                    <TableRow key={item.project}>
                      <TableCell sx={{ color: 'var(--ff-text-primary)', borderColor: 'var(--ff-border-light)' }}>{item.project}</TableCell>
                      <TableCell align="right" sx={{ borderColor: 'var(--ff-border-light)' }}>
                        <Typography variant="h6" color="primary">
                          {item.count}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ backgroundColor: 'var(--ff-bg-hover)' }}>
                    <TableCell sx={{ color: 'var(--ff-text-primary)', borderColor: 'var(--ff-border-light)' }}><strong>Total</strong></TableCell>
                    <TableCell align="right" sx={{ borderColor: 'var(--ff-border-light)' }}>
                      <Typography variant="h6" color="primary">
                        <strong>{dailyDrops.total}</strong>
                      </Typography>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      {drops.length > 0 && (
        <WaMonitorFilters
          onFilterChange={handleFilterChange}
          totalCount={drops.length}
          filteredCount={filteredDrops.length}
          availableProjects={availableProjects}
        />
      )}

      {/* Pagination Info */}
      {filteredDrops.length > 0 && (
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}-
          {Math.min(currentPage * ITEMS_PER_PAGE, filteredDrops.length)} of {filteredDrops.length} drops
        </Typography>
      )}

      {/* QA Review Cards */}
      {loading && drops.length === 0 ? (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
          <CircularProgress />
        </Box>
      ) : drops.length === 0 ? (
        <Card sx={{ bgcolor: 'var(--ff-bg-secondary)' }}>
          <CardContent>
            <Typography variant="body1" sx={{ color: 'var(--ff-text-secondary)' }} textAlign="center">
              No drops to review
            </Typography>
          </CardContent>
        </Card>
      ) : filteredDrops.length === 0 ? (
        <Card sx={{ bgcolor: 'var(--ff-bg-secondary)' }}>
          <CardContent>
            <Typography variant="body1" sx={{ color: 'var(--ff-text-secondary)' }} textAlign="center">
              No drops match your filters. Try adjusting your search or filter criteria.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <>
          <Box>
            {paginatedDrops.map((drop) => {
              // Phase 6: Feature flag for gradual rollout
              const useUnifiedReview = isUnifiedReviewEnabled(drop.project);

              return useUnifiedReview ? (
                // NEW: Unified review card (Phase 6 rollout)
                <UnifiedReviewCard
                  key={drop.id}
                  dropNumber={drop.dropNumber}
                />
              ) : (
                // OLD: Original QA review card (legacy system)
                <QaReviewCard
                  key={drop.id}
                  drop={drop}
                  onUpdate={handleDropUpdate}
                  onSendFeedback={handleSendFeedback}
                />
              );
            })}
          </Box>

          {/* Pagination */}
          {totalPages > 1 && (
            <Box display="flex" justifyContent="center" mt={4}>
              <Pagination
                count={totalPages}
                page={currentPage}
                onChange={handlePageChange}
                color="primary"
                size="large"
                showFirstButton
                showLastButton
              />
            </Box>
          )}
        </>
      )}
    </div>
  );
}
