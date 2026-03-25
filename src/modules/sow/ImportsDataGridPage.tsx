'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Box, Tab, Tabs, Paper } from '@mui/material';

const DataGrid = dynamic(
  () => import('@mui/x-data-grid').then(mod => mod.DataGrid),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-96 text-sm text-gray-400">Loading data grid...</div> }
);

const GridToolbar = dynamic(
  () => import('@mui/x-data-grid').then(mod => mod.GridToolbar),
  { ssr: false }
);
import {
  TabPanel,
  StatsCards,
  LinkingStatsAlert,
  HeaderSection
} from './imports-datagrid';
import { useImportsData } from './imports-datagrid';
import {
  polesColumns,
  fibreColumns,
  dropsColumns,
  onemapColumns,
  nokiaColumns
} from './imports-datagrid';
import type { Project, MatchingMode } from './imports-datagrid';

export function ImportsDataGridPage() {
  const [tabValue, setTabValue] = useState(0);
  const [projectId, setProjectId] = useState('e2a61399-275a-4c44-8008-e9e42b7a3501');
  const [matchingMode, setMatchingMode] = useState<MatchingMode>('enhanced');
  const [projects] = useState<Project[]>([
    { id: 'e2a61399-275a-4c44-8008-e9e42b7a3501', name: 'louissep15' },
    { id: '7e7a6d88-8da1-4ac3-a16e-4b7a91e83439', name: 'louisProjectTestWed' }
  ]);

  const {
    polesData,
    fibreData,
    dropsData,
    onemapData,
    nokiaData,
    loading,
    linkingStats
  } = useImportsData({ projectId, matchingMode });

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header with Project & Matching Mode Selectors */}
      <HeaderSection
        projectId={projectId}
        projects={projects}
        matchingMode={matchingMode}
        onProjectChange={setProjectId}
        onMatchingModeChange={setMatchingMode}
      />

      {/* Linking Stats Alert */}
      <LinkingStatsAlert stats={linkingStats} />

      {/* Stats Summary Cards */}
      <StatsCards
        polesCount={polesData.length}
        fibreCount={fibreData.length}
        dropsCount={dropsData.length}
        onemapCount={onemapData.length}
        nokiaCount={nokiaData.length}
      />

      {/* Data Grids with Tabs */}
      <Paper>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={(e, newValue) => setTabValue(newValue)}>
            <Tab label={`SOW Poles (${polesData.length})`} />
            <Tab label={`Fibre (${fibreData.length})`} />
            <Tab label={`SOW Drops (${dropsData.length})`} />
            <Tab label={`OneMap Field (${onemapData.length})`} />
            <Tab label={`Nokia Drops (${nokiaData.length})`} />
          </Tabs>
        </Box>

        {/* Poles Grid */}
        <TabPanel value={tabValue} index={0}>
          <div style={{ height: 600, width: '100%' }}>
            <DataGrid
              rows={polesData}
              columns={polesColumns}
              pageSize={50}
              rowsPerPageOptions={[25, 50, 100]}
              checkboxSelection
              disableSelectionOnClick
              loading={loading}
              getRowId={(row) => row.id || row.pole_number}
              slots={{ toolbar: GridToolbar }}
              slotProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 500 },
                },
              }}
            />
          </div>
        </TabPanel>

        {/* Fibre Grid */}
        <TabPanel value={tabValue} index={1}>
          <div style={{ height: 600, width: '100%' }}>
            <DataGrid
              rows={fibreData}
              columns={fibreColumns}
              pageSize={50}
              rowsPerPageOptions={[25, 50, 100]}
              checkboxSelection
              disableSelectionOnClick
              loading={loading}
              getRowId={(row) => row.id || row.segment_id}
              slots={{ toolbar: GridToolbar }}
              slotProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 500 },
                },
              }}
            />
          </div>
        </TabPanel>

        {/* Drops Grid */}
        <TabPanel value={tabValue} index={2}>
          <div style={{ height: 600, width: '100%' }}>
            <DataGrid
              rows={dropsData}
              columns={dropsColumns}
              pageSize={50}
              rowsPerPageOptions={[25, 50, 100]}
              checkboxSelection
              disableSelectionOnClick
              loading={loading}
              getRowId={(row) => row.id || row.drop_number}
              slots={{ toolbar: GridToolbar }}
              slotProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 500 },
                },
              }}
            />
          </div>
        </TabPanel>

        {/* OneMap Field Data Grid */}
        <TabPanel value={tabValue} index={3}>
          <div style={{ height: 600, width: '100%' }}>
            <DataGrid
              rows={onemapData}
              columns={onemapColumns}
              pageSize={50}
              rowsPerPageOptions={[25, 50, 100]}
              checkboxSelection
              disableSelectionOnClick
              loading={loading}
              getRowId={(row) => row.id || row.property_id}
              slots={{ toolbar: GridToolbar }}
              slotProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 500 },
                },
              }}
            />
          </div>
        </TabPanel>

        {/* Nokia Drops Grid */}
        <TabPanel value={tabValue} index={4}>
          <div style={{ height: 600, width: '100%' }}>
            <DataGrid
              rows={nokiaData}
              columns={nokiaColumns}
              pageSize={50}
              rowsPerPageOptions={[25, 50, 100]}
              checkboxSelection
              disableSelectionOnClick
              loading={loading}
              getRowId={(row) => row.id || `${row.property_id}_${row.drop_number}`}
              slots={{ toolbar: GridToolbar }}
              slotProps={{
                toolbar: {
                  showQuickFilter: true,
                  quickFilterProps: { debounceMs: 500 },
                },
              }}
            />
          </div>
        </TabPanel>
      </Paper>
    </div>
  );
}
