/**
 * Photo List Tab Component
 * Shows paginated list of photos with filters and bulk actions
 */

'use client';

import { useState, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  Checkbox,
  Chip,
  IconButton,
  Pagination,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Button,
  Menu,
  Tooltip,
} from '@mui/material';
import {
  Search,
  Filter,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RotateCw,
  UserPlus,
  MoreVertical,
  Clock,
  Camera,
} from 'lucide-react';
import { qfieldQaApiService } from '../services/qfieldQaApiService';
import type { PhotoValidation, QAProject, QAFilters, Priority, WorkflowStatus } from '../types';

interface PhotoListTabProps {
  validations: PhotoValidation[];
  projects: QAProject[];
  filters: QAFilters;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  loading: boolean;
  selectedIds: string[];
  onFilterChange: (filters: Partial<QAFilters>) => void;
  onPageChange: (page: number) => void;
  onPhotoClick: (photo: PhotoValidation) => void;
  onSelectionChange: (ids: string[]) => void;
  onApprove: (ids: string[], notes?: string) => Promise<void>;
  onReject: (ids: string[], notes?: string) => Promise<void>;
  onEscalate: (ids: string[], reason: string) => Promise<void>;
  onRevalidate: (ids: string[]) => Promise<void>;
  onAssign: (ids: string[], assignee: string, options?: { dueDate?: string; priority?: string }) => Promise<void>;
}

export function PhotoListTab({
  validations,
  projects,
  filters,
  pagination,
  loading,
  selectedIds,
  onFilterChange,
  onPageChange,
  onPhotoClick,
  onSelectionChange,
  onApprove,
  onReject,
  onEscalate,
  onRevalidate,
  onAssign,
}: PhotoListTabProps) {
  const [searchTerm, setSearchTerm] = useState(filters.search || '');
  const [bulkMenuAnchor, setBulkMenuAnchor] = useState<null | HTMLElement>(null);

  // Handle select all
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectionChange(validations.map(v => v.id));
    } else {
      onSelectionChange([]);
    }
  };

  // Handle single select
  const handleSelect = (id: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedIds, id]);
    } else {
      onSelectionChange(selectedIds.filter(i => i !== id));
    }
  };

  // Handle search
  const handleSearch = () => {
    onFilterChange({ search: searchTerm });
  };

  // Handle bulk actions
  const handleBulkAction = async (action: 'approve' | 'reject' | 'revalidate') => {
    setBulkMenuAnchor(null);
    if (selectedIds.length === 0) return;

    switch (action) {
      case 'approve':
        await onApprove(selectedIds);
        break;
      case 'reject':
        await onReject(selectedIds);
        break;
      case 'revalidate':
        await onRevalidate(selectedIds);
        break;
    }
  };

  const allSelected = validations.length > 0 && selectedIds.length === validations.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < validations.length;

  return (
    <Box>
      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search photos..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                InputProps={{
                  startAdornment: <Search className="w-4 h-4 mr-2 text-gray-400" />,
                }}
              />
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Project</InputLabel>
                <Select
                  value={filters.projectId || ''}
                  label="Project"
                  onChange={(e) => onFilterChange({ projectId: e.target.value || undefined })}
                >
                  <MenuItem value="">All Projects</MenuItem>
                  {projects.map(p => (
                    <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Work Type</InputLabel>
                <Select
                  value={filters.workType || ''}
                  label="Work Type"
                  onChange={(e) => onFilterChange({ workType: e.target.value as any || undefined })}
                >
                  <MenuItem value="">All Types</MenuItem>
                  <MenuItem value="pole_installation">Pole Installation</MenuItem>
                  <MenuItem value="cable_stringing">Cable Stringing</MenuItem>
                  <MenuItem value="dome_joint">Dome Joint</MenuItem>
                  <MenuItem value="activation">Activation</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select
                  value={filters.workflowStatus || ''}
                  label="Status"
                  onChange={(e) => onFilterChange({ workflowStatus: e.target.value as WorkflowStatus || undefined })}
                >
                  <MenuItem value="">All Statuses</MenuItem>
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="in_review">In Review</MenuItem>
                  <MenuItem value="approved">Approved</MenuItem>
                  <MenuItem value="rejected">Rejected</MenuItem>
                  <MenuItem value="escalated">Escalated</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Priority</InputLabel>
                <Select
                  value={filters.priority || ''}
                  label="Priority"
                  onChange={(e) => onFilterChange({ priority: e.target.value as Priority || undefined })}
                >
                  <MenuItem value="">All Priorities</MenuItem>
                  <MenuItem value="urgent">Urgent</MenuItem>
                  <MenuItem value="high">High</MenuItem>
                  <MenuItem value="normal">Normal</MenuItem>
                  <MenuItem value="low">Low</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={3} md={1}>
              <Button
                variant="outlined"
                onClick={() => {
                  setSearchTerm('');
                  onFilterChange({
                    projectId: undefined,
                    workType: undefined,
                    workflowStatus: undefined,
                    priority: undefined,
                    search: undefined,
                  });
                }}
                sx={{ minWidth: 'auto' }}
              >
                Clear
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <Box sx={{
          mb: 2,
          p: 2,
          bgcolor: 'primary.light',
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <Typography variant="body2" fontWeight="bold" color="primary.contrastText">
            {selectedIds.length} photo{selectedIds.length !== 1 ? 's' : ''} selected
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<CheckCircle className="w-4 h-4" />}
              onClick={() => handleBulkAction('approve')}
            >
              Approve
            </Button>
            <Button
              size="small"
              variant="contained"
              color="error"
              startIcon={<XCircle className="w-4 h-4" />}
              onClick={() => handleBulkAction('reject')}
            >
              Reject
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RotateCw className="w-4 h-4" />}
              onClick={() => handleBulkAction('revalidate')}
              sx={{ bgcolor: 'white' }}
            >
              Re-validate
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => onSelectionChange([])}
              sx={{ bgcolor: 'white' }}
            >
              Clear
            </Button>
          </Box>
        </Box>
      )}

      {/* Photo List Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, px: 1 }}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={(e) => handleSelectAll(e.target.checked)}
          size="small"
        />
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {pagination.total} photos total • Page {pagination.page} of {pagination.totalPages}
        </Typography>
      </Box>

      {/* Photo Cards */}
      {validations.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Camera className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <Typography color="text.secondary">No photos found</Typography>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {validations.map((photo) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={photo.id}>
              <PhotoCard
                photo={photo}
                selected={selectedIds.includes(photo.id)}
                onSelect={(checked) => handleSelect(photo.id, checked)}
                onClick={() => onPhotoClick(photo)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={pagination.totalPages}
            page={pagination.page}
            onChange={(_, page) => onPageChange(page)}
            color="primary"
          />
        </Box>
      )}
    </Box>
  );
}

interface PhotoCardProps {
  photo: PhotoValidation;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onClick: () => void;
}

function PhotoCard({ photo, selected, onSelect, onClick }: PhotoCardProps) {
  const photoUrl = qfieldQaApiService.getPhotoUrl(photo.photo_key);
  const filename = photo.photo_key.split('/').pop() || photo.photo_key;
  const confidence = photo.vlm_confidence !== null ? (photo.vlm_confidence * 100).toFixed(0) : null;

  return (
    <Card
      sx={{
        cursor: 'pointer',
        border: selected ? '2px solid' : '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        transition: 'all 0.2s',
        '&:hover': { boxShadow: 4 },
      }}
    >
      <Box sx={{ position: 'relative' }}>
        <Checkbox
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onSelect(e.target.checked);
          }}
          sx={{ position: 'absolute', top: 4, left: 4, bgcolor: 'rgba(255,255,255,0.8)', borderRadius: 1 }}
          size="small"
        />
        <Box
          onClick={onClick}
          sx={{
            height: 160,
            bgcolor: 'grey.200',
            backgroundImage: `url(${photoUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        {/* Status Badge */}
        <Box sx={{ position: 'absolute', top: 4, right: 4 }}>
          <StatusBadge status={photo.workflow_status} />
        </Box>
        {/* Confidence Badge */}
        {confidence !== null && (
          <Box sx={{ position: 'absolute', bottom: 4, right: 4 }}>
            <Chip
              label={`${confidence}%`}
              size="small"
              sx={{
                bgcolor: getConfidenceColor(photo.vlm_confidence || 0),
                color: 'white',
                fontWeight: 'bold',
              }}
            />
          </Box>
        )}
      </Box>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }} onClick={onClick}>
        <Typography variant="body2" fontWeight="medium" noWrap title={filename}>
          {filename}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Chip
            label={formatWorkType(photo.work_type)}
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.65rem', height: 20 }}
          />
          {photo.priority !== 'normal' && (
            <PriorityChip priority={photo.priority} />
          )}
        </Box>
        {photo.assigned_to && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Assigned to: {photo.assigned_to}
          </Typography>
        )}
        {photo.due_date && new Date(photo.due_date) < new Date() && photo.workflow_status !== 'approved' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, color: 'error.main' }}>
            <Clock className="w-3 h-3" />
            <Typography variant="caption">Overdue</Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const config = {
    pending: { label: 'Pending', color: '#eab308' },
    in_review: { label: 'In Review', color: '#3b82f6' },
    approved: { label: 'Approved', color: '#22c55e' },
    rejected: { label: 'Rejected', color: '#ef4444' },
    escalated: { label: 'Escalated', color: '#f97316' },
  }[status] || { label: status, color: '#6b7280' };

  return (
    <Chip
      label={config.label}
      size="small"
      sx={{
        bgcolor: config.color,
        color: 'white',
        fontSize: '0.65rem',
        height: 20,
      }}
    />
  );
}

function PriorityChip({ priority }: { priority: Priority }) {
  const config = {
    urgent: { label: 'Urgent', color: 'error' as const },
    high: { label: 'High', color: 'warning' as const },
    low: { label: 'Low', color: 'default' as const },
  }[priority];

  if (!config) return null;

  return (
    <Chip
      label={config.label}
      size="small"
      color={config.color}
      sx={{ fontSize: '0.65rem', height: 20 }}
    />
  );
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#22c55e';
  if (confidence >= 0.6) return '#f97316';
  return '#ef4444';
}

function formatWorkType(workType: string | null): string {
  if (!workType) return 'Unknown';
  switch (workType) {
    case 'pole_installation': return 'Pole';
    case 'cable_stringing': return 'Cable';
    case 'dome_joint': return 'Dome';
    case 'activation': return 'Activation';
    default: return workType;
  }
}

export default PhotoListTab;
