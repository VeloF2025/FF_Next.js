/**
 * Daily Reconciliation Dashboard
 * Stage 4 of the 4-stage Site Stock Tracking System
 *
 * Purpose: End-of-day accountability report showing issued vs installed stock
 * Access: Warehouse managers, project managers
 *
 * Features:
 * - Technician-by-technician breakdown
 * - Unaccounted sizes highlighted
 * - Export to Excel
 * - Automated blocking alerts
 *
 * Integration: Uses /api/field-stock/reports/daily-reconciliation
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  Button,
  CircularProgress,
  TextField,
  Chip,
  Card,
  CardContent,
  IconButton,
  Collapse,
  Tooltip,
  Stack,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Refresh as RefreshIcon,
  Block as BlockIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { log } from '@/lib/logger';

// ==================== TYPES ====================

interface TechnicianReconciliation {
  id: string;
  name: string;
  contractorId?: string;
  contractorName?: string;
  issued_count: number;
  issued_serials: string[];
  installed_count: number;
  installed_serials: string[];
  returned_count: number;
  returned_serials: string[];
  unaccounted_count: number;
  unaccounted_serials: string[];
  unaccounted_value: number;
  is_blocked: boolean;
  pending_recovery: number;
}

interface ReconciliationSummary {
  total_issued: number;
  total_installed: number;
  total_returned: number;
  total_unaccounted: number;
  unaccounted_value: number;
  technician_count: number;
}

interface DailyReconciliationData {
  date: string;
  technicians: TechnicianReconciliation[];
  summary: ReconciliationSummary;
}

interface DailyReconciliationDashboardProps {
  defaultDate?: string;
  project?: string;
  onTechnicianClick?: (technicianId: string) => void;
}

// ==================== THRESHOLDS ====================

const UNACCOUNTED_COUNT_THRESHOLD = 3;
const UNACCOUNTED_VALUE_THRESHOLD = 5000;

// ==================== COMPONENT ====================

export function DailyReconciliationDashboard({
  defaultDate,
  project,
  onTechnicianClick,
}: DailyReconciliationDashboardProps) {
  // State
  const [selectedDate, setSelectedDate] = useState<string>(
    defaultDate || format(new Date(), 'yyyy-MM-dd')
  );
  const [data, setData] = useState<DailyReconciliationData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTechnicianIds, setExpandedTechnicianIds] = useState<Set<string>>(new Set());

  // ==================== DATA FETCHING ====================

  const fetchReconciliation = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ date: selectedDate });
      if (project) {
        params.append('project', project);
      }

      const response = await fetch(`/api/field-stock/reports/daily-reconciliation?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to fetch reconciliation data');
      }

      const result = await response.json();
      if (result.success) {
        setData(result.data);
      } else {
        throw new Error(result.error?.message || 'Failed to load data');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      log.error('Failed to fetch reconciliation', { error: errorMessage }, 'DailyReconciliationDashboard');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReconciliation();
  }, [selectedDate, project]);

  // ==================== HANDLERS ====================

  const handleDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(event.target.value);
  };

  const handleRefresh = () => {
    fetchReconciliation();
  };

  const toggleTechnicianExpand = (technicianId: string) => {
    setExpandedTechnicianIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(technicianId)) {
        newSet.delete(technicianId);
      } else {
        newSet.add(technicianId);
      }
      return newSet;
    });
  };

  const handleExportToExcel = () => {
    if (!data) return;

    // Prepare CSV data
    const csvRows = [];

    // Header
    csvRows.push([
      'Technician',
      'Contractor',
      'Issued',
      'Installed',
      'Returned',
      'Unaccounted',
      'Value (R)',
      'Status',
    ].join(','));

    // Technician rows
    data.technicians.forEach((tech) => {
      csvRows.push([
        tech.name,
        tech.contractorName || 'N/A',
        tech.issued_count,
        tech.installed_count,
        tech.returned_count,
        tech.unaccounted_count,
        tech.unaccounted_value.toFixed(2),
        tech.is_blocked ? 'BLOCKED' : 'Active',
      ].join(','));
    });

    // Summary row
    csvRows.push([]);
    csvRows.push([
      'SUMMARY',
      '',
      data.summary.total_issued,
      data.summary.total_installed,
      data.summary.total_returned,
      data.summary.total_unaccounted,
      data.summary.unaccounted_value.toFixed(2),
      '',
    ].join(','));

    // Create blob and download
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `reconciliation_${selectedDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ==================== HELPER FUNCTIONS ====================

  const shouldShowWarning = (tech: TechnicianReconciliation): boolean => {
    return (
      tech.unaccounted_count > UNACCOUNTED_COUNT_THRESHOLD ||
      tech.unaccounted_value > UNACCOUNTED_VALUE_THRESHOLD
    );
  };

  const getStatusChip = (tech: TechnicianReconciliation) => {
    if (tech.is_blocked) {
      return <Chip label="BLOCKED" color="error" size="small" icon={<BlockIcon />} />;
    }
    if (shouldShowWarning(tech)) {
      return <Chip label="WARNING" color="warning" size="small" icon={<WarningIcon />} />;
    }
    return <Chip label="Good" color="success" size="small" icon={<CheckCircleIcon />} />;
  };

  // ==================== RENDER ====================

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          Daily Stock Reconciliation
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            type="date"
            label="Date"
            value={selectedDate}
            onChange={handleDateChange}
            InputLabelProps={{ shrink: true }}
            size="small"
          />
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={handleExportToExcel}
            disabled={!data || loading}
          >
            Export to Excel
          </Button>
        </Box>
      </Box>

      {/* Loading State */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Error State */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Data Display */}
      {!loading && data && (
        <>
          {/* Summary Cards */}
          <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}>
            <Card sx={{ flex: '1 1 200px', minWidth: '200px' }}>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="body2">
                  Total Issued
                </Typography>
                <Typography variant="h5">{data.summary.total_issued}</Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: '1 1 200px', minWidth: '200px' }}>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="body2">
                  Total Installed
                </Typography>
                <Typography variant="h5">{data.summary.total_installed}</Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: '1 1 200px', minWidth: '200px' }}>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="body2">
                  Total Returned
                </Typography>
                <Typography variant="h5">{data.summary.total_returned}</Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: '1 1 200px', minWidth: '200px', bgcolor: data.summary.total_unaccounted > 0 ? 'warning.light' : 'background.paper' }}>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="body2">
                  Unaccounted
                </Typography>
                <Typography variant="h5" color={data.summary.total_unaccounted > 0 ? 'error' : 'inherit'}>
                  {data.summary.total_unaccounted}
                </Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: '1 1 200px', minWidth: '200px', bgcolor: data.summary.unaccounted_value > 0 ? 'warning.light' : 'background.paper' }}>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="body2">
                  Unaccounted Value
                </Typography>
                <Typography variant="h5" color={data.summary.unaccounted_value > 0 ? 'error' : 'inherit'}>
                  R{data.summary.unaccounted_value.toFixed(2)}
                </Typography>
              </CardContent>
            </Card>
          </Stack>

          {/* Warning Alert for threshold breaches */}
          {data.technicians.some(shouldShowWarning) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>Attention:</strong> Some technicians have exceeded unaccounted stock thresholds.
              Review details below and consider blocking contractors if necessary.
            </Alert>
          )}

          {/* Technician Table */}
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell>Technician</TableCell>
                  <TableCell>Contractor</TableCell>
                  <TableCell align="center">Issued</TableCell>
                  <TableCell align="center">Installed</TableCell>
                  <TableCell align="center">Returned</TableCell>
                  <TableCell align="center">Unaccounted</TableCell>
                  <TableCell align="right">Value (R)</TableCell>
                  <TableCell align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.technicians.map((tech) => {
                  const isExpanded = expandedTechnicianIds.has(tech.id);
                  const hasUnaccounted = tech.unaccounted_count > 0;

                  return (
                    <React.Fragment key={tech.id}>
                      {/* Main Row */}
                      <TableRow
                        sx={{
                          bgcolor: hasUnaccounted ? 'error.light' : 'inherit',
                          '&:hover': { bgcolor: 'action.hover', cursor: 'pointer' },
                        }}
                        onClick={() => onTechnicianClick?.(tech.id)}
                      >
                        <TableCell>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTechnicianExpand(tech.id);
                            }}
                            disabled={!hasUnaccounted}
                          >
                            {hasUnaccounted && (isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />)}
                          </IconButton>
                        </TableCell>
                        <TableCell>{tech.name}</TableCell>
                        <TableCell>{tech.contractorName || 'N/A'}</TableCell>
                        <TableCell align="center">{tech.issued_count}</TableCell>
                        <TableCell align="center">{tech.installed_count}</TableCell>
                        <TableCell align="center">{tech.returned_count}</TableCell>
                        <TableCell align="center">
                          <Typography
                            sx={{
                              fontWeight: hasUnaccounted ? 'bold' : 'normal',
                              color: hasUnaccounted ? 'error.main' : 'inherit',
                            }}
                          >
                            {tech.unaccounted_count}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            sx={{
                              fontWeight: hasUnaccounted ? 'bold' : 'normal',
                              color: hasUnaccounted ? 'error.main' : 'inherit',
                            }}
                          >
                            R{tech.unaccounted_value.toFixed(2)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">{getStatusChip(tech)}</TableCell>
                      </TableRow>

                      {/* Expanded Row - Serial Details */}
                      {hasUnaccounted && (
                        <TableRow>
                          <TableCell colSpan={9} sx={{ py: 0 }}>
                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                              <Box sx={{ p: 2, bgcolor: 'grey.50' }}>
                                <Typography variant="subtitle2" gutterBottom>
                                  Unaccounted Serials:
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                  {tech.unaccounted_serials.map((serial) => (
                                    <Chip key={serial} label={serial} size="small" color="error" variant="outlined" />
                                  ))}
                                </Box>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Empty State */}
          {data.technicians.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body1" color="textSecondary">
                No technician activity found for {selectedDate}
              </Typography>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

export default DailyReconciliationDashboard;
