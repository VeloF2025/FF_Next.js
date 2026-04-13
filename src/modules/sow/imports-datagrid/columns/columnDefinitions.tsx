// ============= Data Grid Column Definitions =============

import { GridColDef } from '@mui/x-data-grid';
import { Chip, Typography } from '@mui/material';

// ============= Poles Columns =============
export const polesColumns: GridColDef[] = [
  { field: 'pole_number', headerName: 'Pole Number', width: 150 },
  {
    field: 'latitude',
    headerName: 'Latitude',
    width: 120,
    valueFormatter: (value) => value ? parseFloat(value).toFixed(6) : 'N/A'
  },
  {
    field: 'longitude',
    headerName: 'Longitude',
    width: 120,
    valueFormatter: (value) => value ? parseFloat(value).toFixed(6) : 'N/A'
  },
  {
    field: 'status',
    headerName: 'Status',
    width: 150,
    renderCell: (params) => (
      <Chip
        label={params.value || 'Unknown'}
        color={params.value === 'approved' ? 'success' : 'default'}
        size="small"
      />
    )
  },
  { field: 'address', headerName: 'Address', width: 250 },
  { field: 'municipality', headerName: 'Municipality', width: 150 },
  { field: 'owner', headerName: 'Owner', width: 150 },
  { field: 'height', headerName: 'Height', width: 100 },
  {
    field: 'created_at',
    headerName: 'Created',
    width: 150,
    type: 'dateTime',
    valueGetter: (value) => value ? new Date(value) : null
  }
];

// ============= Fibre Columns =============
export const fibreColumns: GridColDef[] = [
  { field: 'segment_id', headerName: 'Segment ID', width: 150 },
  { field: 'start_point', headerName: 'Start Point', width: 150 },
  { field: 'end_point', headerName: 'End Point', width: 150 },
  { field: 'cable_type', headerName: 'Cable Type', width: 120 },
  {
    field: 'cable_length',
    headerName: 'Length (m)',
    width: 120,
    valueFormatter: (value) => value ? parseFloat(value).toFixed(2) : '0'
  },
  { field: 'layer', headerName: 'Layer', width: 150 },
  {
    field: 'status',
    headerName: 'Status',
    width: 130,
    renderCell: (params) => (
      <Chip
        label={params.value || 'planned'}
        color={params.value === 'completed' ? 'success' : 'primary'}
        size="small"
      />
    )
  },
  { field: 'contractor', headerName: 'Contractor', width: 150 },
  {
    field: 'created_at',
    headerName: 'Created',
    width: 150,
    type: 'dateTime',
    valueGetter: (value) => value ? new Date(value) : null
  }
];

// ============= Drops Columns =============
export const dropsColumns: GridColDef[] = [
  { field: 'drop_number', headerName: 'Drop Number', width: 150 },
  { field: 'pole_number', headerName: 'Pole Number', width: 150 },
  { field: 'start_point', headerName: 'Start Point', width: 150 },
  { field: 'end_point', headerName: 'End Point (ONT)', width: 200 },
  {
    field: 'cable_length',
    headerName: 'Length (m)',
    width: 120,
    valueFormatter: (value) => value ? parseFloat(value).toFixed(2) : '0'
  },
  { field: 'cable_type', headerName: 'Cable Type', width: 120 },
  {
    field: 'status',
    headerName: 'Status',
    width: 130,
    renderCell: (params) => (
      <Chip
        label={params.value || 'planned'}
        color={params.value === 'active' ? 'success' : 'info'}
        size="small"
      />
    )
  },
  { field: 'address', headerName: 'Address', width: 250 },
  {
    field: 'created_at',
    headerName: 'Created',
    width: 150,
    type: 'dateTime',
    valueGetter: (value) => value ? new Date(value) : null
  }
];

// ============= OneMap Field Data Columns =============
export const onemapColumns: GridColDef[] = [
  { field: 'property_id', headerName: 'Property ID', width: 150 },
  { field: 'onemap_id', headerName: 'OneMap ID', width: 150 },
  { field: 'location_address', headerName: 'Address', width: 250 },
  { field: 'pole_number', headerName: 'Pole #', width: 100 },
  { field: 'drop_number', headerName: 'Drop #', width: 100 },
  {
    field: 'status',
    headerName: 'Field Status',
    width: 150,
    renderCell: (params) => {
      const status = params.value || 'unknown';
      let color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' = 'default';
      if (status.includes('Approved')) color = 'success';
      else if (status.includes('Complete')) color = 'success';
      else if (status.includes('Installed')) color = 'info';
      else if (status.includes('Survey')) color = 'warning';
      return (
        <Chip
          label={status}
          color={color}
          size="small"
        />
      );
    }
  },
  {
    field: 'latitude',
    headerName: 'Latitude',
    width: 110,
    valueFormatter: (value) => value ? parseFloat(value).toFixed(6) : ''
  },
  {
    field: 'longitude',
    headerName: 'Longitude',
    width: 110,
    valueFormatter: (value) => value ? parseFloat(value).toFixed(6) : ''
  },
  { field: 'contact_name', headerName: 'Contact Name', width: 120 },
  { field: 'contact_surname', headerName: 'Surname', width: 120 },
  { field: 'contact_number', headerName: 'Phone', width: 120 },
  {
    field: 'sow_pole_number',
    headerName: 'Linked SOW',
    width: 120,
    renderCell: (params) => {
      if (params.value) {
        const matchType = params.row.match_type || 'exact';
        const labels = {
          exact: '✓ Exact',
          normalized: '✓ Normalized',
          proximity: '✓ Proximity'
        };
        const colors = {
          exact: 'success',
          normalized: 'info',
          proximity: 'warning'
        };
        return (
          <Chip
            label={labels[matchType as keyof typeof labels] || '✓ Linked'}
            color={colors[matchType as keyof typeof colors] || 'success'}
            size="small"
          />
        );
      }
      return <Chip label="Not Linked" variant="outlined" size="small" />;
    }
  },
  {
    field: 'match_type',
    headerName: 'Match Type',
    width: 100,
    renderCell: (params) => {
      if (!params.value) return '-';
      return (
        <Typography variant="caption" color="textSecondary">
          {params.value}
        </Typography>
      );
    }
  },
  {
    field: 'drop_cable_length',
    headerName: 'Drop Cable (m)',
    width: 120,
    valueFormatter: (value) => value || ''
  },
  {
    field: 'home_signup_date',
    headerName: 'Signup Date',
    width: 150,
    type: 'dateTime',
    valueGetter: (value) => value ? new Date(value) : null
  }
];

// ============= Nokia Velocity Columns (Focus on Drops) =============
export const nokiaColumns: GridColDef[] = [
  { field: 'drop_number', headerName: 'Drop Number', width: 150 },
  { field: 'property_id', headerName: 'Property ID', width: 120 },
  {
    field: 'ont_barcode',
    headerName: 'ONT Barcode',
    width: 150,
    renderCell: (params) => params.value ? (
      <Chip label={params.value} color="success" size="small" />
    ) : <Chip label="Not Installed" variant="outlined" size="small" />
  },
  {
    field: 'status',
    headerName: 'Installation Status',
    width: 250,
    renderCell: (params) => {
      const status = params.value || 'Unknown';
      let color: 'success' | 'warning' | 'info' | 'default' = 'default';
      if (status.includes('Installed')) color = 'success';
      else if (status.includes('In Progress')) color = 'warning';
      else if (status.includes('Approved')) color = 'info';
      return <Chip label={status} color={color} size="small" />;
    }
  },
  { field: 'pole_number', headerName: 'Pole Number', width: 120 },
  { field: 'stand_number', headerName: 'Stand Number', width: 120 },
  {
    field: 'installation_date',
    headerName: 'Install Date',
    width: 130,
    type: 'date',
    valueGetter: (value) => value ? new Date(value) : null
  },
  {
    field: 'latitude',
    headerName: 'Latitude',
    width: 110,
    valueFormatter: (value) => value ? parseFloat(value).toFixed(6) : ''
  },
  {
    field: 'longitude',
    headerName: 'Longitude',
    width: 110,
    valueFormatter: (value) => value ? parseFloat(value).toFixed(6) : ''
  }
];
