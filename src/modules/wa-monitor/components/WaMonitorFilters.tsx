/**
 * WA Monitor Filters Component
 * Search and filter controls for QA review drops
 */

'use client';

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Button,
  InputAdornment,
} from '@mui/material';
import { Search, X } from 'lucide-react';
import type { DropStatus } from '../types/wa-monitor.types';

interface WaMonitorFiltersProps {
  onFilterChange: (filters: FilterState) => void;
  totalCount: number;
  filteredCount: number;
  availableProjects: string[];
}

export interface FilterState {
  status: DropStatus | 'all';
  searchTerm: string;
  resubmitted?: 'all' | 'resubmitted' | 'not_resubmitted';
  project?: string;
  dateFrom?: string; // ISO date string (YYYY-MM-DD)
  dateTo?: string;   // ISO date string (YYYY-MM-DD)
}

export function WaMonitorFilters({ onFilterChange, totalCount, filteredCount, availableProjects }: WaMonitorFiltersProps) {
  const [status, setStatus] = useState<DropStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [resubmitted, setResubmitted] = useState<'all' | 'resubmitted' | 'not_resubmitted'>('all');
  const [project, setProject] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const handleStatusChange = (newStatus: DropStatus | 'all') => {
    setStatus(newStatus);
    onFilterChange({ status: newStatus, searchTerm, resubmitted, project: project !== 'all' ? project : undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
  };

  const handleSearchChange = (newSearchTerm: string) => {
    setSearchTerm(newSearchTerm);
    onFilterChange({ status, searchTerm: newSearchTerm, resubmitted, project: project !== 'all' ? project : undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
  };

  const handleResubmittedChange = (newResubmitted: 'all' | 'resubmitted' | 'not_resubmitted') => {
    setResubmitted(newResubmitted);
    onFilterChange({ status, searchTerm, resubmitted: newResubmitted, project: project !== 'all' ? project : undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
  };

  const handleProjectChange = (newProject: string) => {
    setProject(newProject);
    onFilterChange({ status, searchTerm, resubmitted, project: newProject !== 'all' ? newProject : undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
  };

  const handleDateFromChange = (newDateFrom: string) => {
    setDateFrom(newDateFrom);
    onFilterChange({ status, searchTerm, resubmitted, project: project !== 'all' ? project : undefined, dateFrom: newDateFrom || undefined, dateTo: dateTo || undefined });
  };

  const handleDateToChange = (newDateTo: string) => {
    setDateTo(newDateTo);
    onFilterChange({ status, searchTerm, resubmitted, project: project !== 'all' ? project : undefined, dateFrom: dateFrom || undefined, dateTo: newDateTo || undefined });
  };

  const handleClearFilters = () => {
    setStatus('all');
    setSearchTerm('');
    setResubmitted('all');
    setProject('all');
    setDateFrom('');
    setDateTo('');
    onFilterChange({ status: 'all', searchTerm: '', resubmitted: 'all', project: undefined, dateFrom: undefined, dateTo: undefined });
  };

  const hasActiveFilters = status !== 'all' || searchTerm !== '' || resubmitted !== 'all' || project !== 'all' || dateFrom !== '' || dateTo !== '';

  // Common dark mode styles for MUI inputs
  const inputSx = {
    '& .MuiOutlinedInput-root': {
      bgcolor: 'var(--ff-bg-tertiary)',
      color: 'var(--ff-text-primary)',
      '& fieldset': { borderColor: 'var(--ff-border-light)' },
      '&:hover fieldset': { borderColor: 'var(--ff-border-medium)' },
    },
    '& .MuiInputLabel-root': { color: 'var(--ff-text-secondary)' },
    '& .MuiInputAdornment-root': { color: 'var(--ff-text-secondary)' },
  };

  return (
    <Card sx={{ mb: 3, bgcolor: 'var(--ff-bg-secondary)' }}>
      <CardContent>
        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          {/* Search by Drop Number */}
          <TextField
            size="small"
            placeholder="Search drop number..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            sx={{ minWidth: 250, ...inputSx }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={18} />
                </InputAdornment>
              ),
            }}
          />

          {/* Filter by Date From */}
          <TextField
            size="small"
            type="date"
            label="From Date"
            value={dateFrom}
            onChange={(e) => handleDateFromChange(e.target.value)}
            sx={{ minWidth: 180, ...inputSx }}
            InputLabelProps={{
              shrink: true,
            }}
          />

          {/* Filter by Date To */}
          <TextField
            size="small"
            type="date"
            label="To Date"
            value={dateTo}
            onChange={(e) => handleDateToChange(e.target.value)}
            sx={{ minWidth: 180, ...inputSx }}
            InputLabelProps={{
              shrink: true,
            }}
          />

          {/* Filter by Status */}
          <FormControl size="small" sx={{ minWidth: 180, ...inputSx }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={status}
              label="Status"
              onChange={(e) => handleStatusChange(e.target.value as DropStatus | 'all')}
            >
              <MenuItem value="all">All Statuses</MenuItem>
              <MenuItem value="incomplete">🔴 Incomplete</MenuItem>
              <MenuItem value="complete">🟢 Complete</MenuItem>
            </Select>
          </FormControl>

          {/* Filter by Resubmitted */}
          <FormControl size="small" sx={{ minWidth: 200, ...inputSx }}>
            <InputLabel>Resubmission</InputLabel>
            <Select
              value={resubmitted}
              label="Resubmission"
              onChange={(e) => handleResubmittedChange(e.target.value as 'all' | 'resubmitted' | 'not_resubmitted')}
            >
              <MenuItem value="all">All Drops</MenuItem>
              <MenuItem value="resubmitted">🔄 Resubmitted Only</MenuItem>
              <MenuItem value="not_resubmitted">New Drops Only</MenuItem>
            </Select>
          </FormControl>

          {/* Filter by Project */}
          <FormControl size="small" sx={{ minWidth: 200, ...inputSx }}>
            <InputLabel>Project</InputLabel>
            <Select
              value={project}
              label="Project"
              onChange={(e) => handleProjectChange(e.target.value)}
            >
              <MenuItem value="all">All Projects</MenuItem>
              {availableProjects.map((proj) => (
                <MenuItem key={proj} value={proj}>
                  {proj}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<X size={16} />}
              onClick={handleClearFilters}
            >
              Clear Filters
            </Button>
          )}

          {/* Results Count */}
          <Box flex={1} display="flex" justifyContent="flex-end" alignItems="center" gap={1}>
            <Chip
              label={`Showing ${filteredCount} of ${totalCount} drops`}
              size="small"
              color={filteredCount === totalCount ? 'default' : 'primary'}
            />
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
