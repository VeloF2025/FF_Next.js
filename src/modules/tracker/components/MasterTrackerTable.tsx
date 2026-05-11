'use client';

import { useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, CellValueChangedEvent } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import type { MasterRow } from '../types/master-tracker.types';

export interface MasterTrackerTableProps {
  rows: MasterRow[];
  editMode: boolean;
  selectLists: Record<string, string[]>;
  filters: Record<string, Set<string>>;
  onRowChange: (rowIndex: number, field: string, value: unknown) => void;
  onFilterChange: (field: string, values: Set<string>) => void;
}

export const MASTER_COLS: ColDef<MasterRow>[] = [
  { field: 'zone_no',              headerName: 'Zone',              width: 80,  pinned: 'left', sortable: true },
  { field: 'hld_pon',              headerName: 'HLD PON',           width: 100, pinned: 'left', sortable: true },
  { field: 'zone_pon',             headerName: 'Zone PON',          width: 100 },
  { field: 'dr',                   headerName: 'DR',                width: 100 },
  { field: 'site',                 headerName: 'Site',              width: 120 },
  { field: 'phase',                headerName: 'Phase',             width: 80 },
  { field: 'pole_label',           headerName: 'Pole Label',        width: 120 },
  { field: 'pole_scope',           headerName: 'Pole Scope',        width: 120 },
  { field: 'pole_type',            headerName: 'Pole Type',         width: 120 },
  { field: 'pole_contractor',      headerName: 'Pole Contractor',   width: 150 },
  { field: 'pole_rate',            headerName: 'Pole Rate',         width: 110, type: 'numericColumn' },
  { field: 'pole_install_date',    headerName: 'Pole Install',      width: 130 },
  { field: 'pole_cwc_date',        headerName: 'Pole CWC',          width: 120 },
  { field: 'pole_paid_date',       headerName: 'Pole Paid',         width: 120 },
  { field: 'pole_invoice_no',      headerName: 'Pole Invoice',      width: 130 },
  { field: 'civil_description',    headerName: 'Civil Desc',        width: 150 },
  { field: 'civil_rate',           headerName: 'Civil Rate',        width: 110, type: 'numericColumn' },
  { field: 'civil_qty',            headerName: 'Civil Qty',         width: 100, type: 'numericColumn' },
  { field: 'civil_total',          headerName: 'Civil Total',       width: 110, type: 'numericColumn' },
  { field: 'civil_invoice_no',     headerName: 'Civil Invoice',     width: 130 },
  { field: 'civil_invoice_date',   headerName: 'Civil Inv Date',    width: 140 },
  { field: 'stringing_description', headerName: 'String Desc',      width: 150 },
  { field: 'stringing_rate',       headerName: 'String Rate',       width: 120, type: 'numericColumn' },
  { field: 'stringing_qty',        headerName: 'String Qty',        width: 110, type: 'numericColumn' },
  { field: 'stringing_total',      headerName: 'String Total',      width: 120, type: 'numericColumn' },
  { field: 'stringing_invoice_no', headerName: 'String Invoice',    width: 140 },
  { field: 'stringing_date',       headerName: 'String Date',       width: 130 },
  { field: 'optical_contractor',   headerName: 'Optical Contractor', width: 160 },
  { field: 'optical_type',         headerName: 'Optical Type',      width: 130 },
  { field: 'optical_splitter',     headerName: 'Splitter',          width: 110 },
  { field: 'optical_rate',         headerName: 'Optical Rate',      width: 120, type: 'numericColumn' },
  { field: 'optical_invoice_no',   headerName: 'Optical Invoice',   width: 140 },
  { field: 'atp_qa_submit_date',   headerName: 'ATP Submit',        width: 130 },
  { field: 'atp_qa_approved_date', headerName: 'ATP Approved',      width: 140 },
  { field: 'activation_code',      headerName: 'Activation Code',   width: 140 },
  { field: 'activation_date',      headerName: 'Activation Date',   width: 140 },
  { field: 'activation_team',      headerName: 'Activation Team',   width: 150 },
  { field: 'activation_rate',      headerName: 'Activation Rate',   width: 140, type: 'numericColumn' },
  { field: 'pon_status',           headerName: 'PON Status',        width: 130 },
];

export function MasterTrackerTable({
  rows,
  editMode,
  onRowChange,
}: MasterTrackerTableProps) {
  const defaultColDef = useMemo<ColDef>(() => ({
    editable: editMode,
    resizable: true,
    filter: true,
    sortable: true,
  }), [editMode]);

  const onCellValueChanged = useCallback((e: CellValueChangedEvent<MasterRow>) => {
    const rowIndex = e.rowIndex ?? 0;
    onRowChange(rowIndex, e.colDef.field as string, e.newValue);
  }, [onRowChange]);

  return (
    <div
      className="ag-theme-alpine-dark w-full"
      style={{ height: 'calc(100vh - 200px)' }}
    >
      <AgGridReact<MasterRow>
        rowData={rows}
        columnDefs={MASTER_COLS}
        defaultColDef={defaultColDef}
        onCellValueChanged={onCellValueChanged}
        rowHeight={36}
        headerHeight={40}
        enableCellTextSelection
        clipboardDelimiter="\t"
      />
    </div>
  );
}
