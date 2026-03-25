/**
 * WA Monitor Grid Component
 * MUI Data Grid for displaying QA review drops
 * Features: Sorting, filtering, export to CSV/Excel
 */

'use client';

import dynamic from 'next/dynamic';
import type { GridColDef } from '@mui/x-data-grid';

const DataGrid = dynamic(
  () => import('@mui/x-data-grid').then(mod => mod.DataGrid),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-96 text-sm text-gray-400">Loading data grid...</div> }
);

const GridToolbar = dynamic(
  () => import('@mui/x-data-grid').then(mod => mod.GridToolbar),
  { ssr: false }
);
import type { QaReviewDrop } from '../types/wa-monitor.types';
import { DropStatusBadge } from './DropStatusBadge';
import { formatDateTime, formatRelativeTime } from '../utils/waMonitorHelpers';

interface WaMonitorGridProps {
  drops: QaReviewDrop[];
  loading?: boolean;
}

export function WaMonitorGrid({ drops, loading = false }: WaMonitorGridProps) {
  // Define columns
  const columns: GridColDef[] = [
    {
      field: 'dropNumber',
      headerName: 'Drop Number',
      width: 150,
      pinnable: true,
      sortable: true,
      filterable: true,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      sortable: true,
      filterable: true,
      renderCell: (params) => (
        <DropStatusBadge status={params.value} size="sm" />
      ),
    },
    {
      field: 'feedbackCount',
      headerName: 'Feedback Count',
      width: 150,
      type: 'number',
      sortable: true,
    },
    {
      field: 'createdAt',
      headerName: 'Created At',
      width: 200,
      sortable: true,
      renderCell: (params) => (
        <span title={formatDateTime(params.value)}>
          {formatRelativeTime(params.value)}
        </span>
      ),
    },
    {
      field: 'updatedAt',
      headerName: 'Updated At',
      width: 200,
      sortable: true,
      renderCell: (params) => (
        <span title={formatDateTime(params.value)}>
          {formatRelativeTime(params.value)}
        </span>
      ),
    },
    {
      field: 'completedAt',
      headerName: 'Completed At',
      width: 200,
      sortable: true,
      renderCell: (params) => (
        params.value ? (
          <span title={formatDateTime(params.value)}>
            {formatRelativeTime(params.value)}
          </span>
        ) : (
          <span className="text-[var(--ff-text-tertiary)]">-</span>
        )
      ),
    },
    {
      field: 'notes',
      headerName: 'Notes',
      width: 250,
      sortable: false,
      filterable: true,
      renderCell: (params) => (
        <span className="truncate" title={params.value || ''}>
          {params.value || '-'}
        </span>
      ),
    },
  ];

  return (
    <div className="w-full" style={{ height: 600 }}>
      <DataGrid
        rows={drops}
        columns={columns}
        loading={loading}
        pageSizeOptions={[10, 25, 50, 100]}
        initialState={{
          pagination: {
            paginationModel: { pageSize: 25 },
          },
          sorting: {
            sortModel: [{ field: 'createdAt', sort: 'desc' }],
          },
        }}
        slots={{
          toolbar: GridToolbar,
        }}
        slotProps={{
          toolbar: {
            showQuickFilter: true,
            quickFilterProps: { debounceMs: 500 },
          },
        }}
        density="comfortable"
        disableRowSelectionOnClick
        sx={{
          '& .MuiDataGrid-cell': {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
          '& .MuiDataGrid-columnHeaders': {
            backgroundColor: 'rgba(0, 0, 0, 0.04)',
            fontWeight: 'bold',
          },
        }}
      />
    </div>
  );
}
