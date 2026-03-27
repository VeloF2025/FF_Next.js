'use client';

import type { MasterRow } from '../types/master-tracker.types';

type ColType = 'text' | 'number' | 'date' | 'checkbox' | 'select';

interface ColDef {
  key: keyof MasterRow;
  label: string;
  type: ColType;
  width: number;
  list?: string; // selectlist name
  group?: string; // visual group label
}

export const MASTER_COLS: ColDef[] = [
  // Identity
  { key: 'site',              label: 'Site',            type: 'text',   width: 90,  group: 'Identity' },
  { key: 'phase',             label: 'Phase',           type: 'number', width: 60,  group: 'Identity' },
  { key: 'dr',                label: 'DR',              type: 'text',   width: 110, group: 'Identity' },
  { key: 'zone_no',           label: 'Zone',            type: 'number', width: 60,  group: 'Identity' },
  { key: 'hld_pon',           label: 'HLD PON',         type: 'number', width: 75,  group: 'Identity' },
  { key: 'zone_pon',          label: 'Zone PON',        type: 'number', width: 75,  group: 'Identity' },
  { key: 'pole_label',        label: 'Pole #',          type: 'text',   width: 110, group: 'Identity' },
  { key: 'unique_pole_label', label: 'Unique Pole #',   type: 'text',   width: 120, group: 'Identity' },
  // Pole Works
  { key: 'pole_scope',        label: 'Scope',           type: 'select', width: 90,  list: 'PoleScope',    group: 'Pole Works' },
  { key: 'pole_type',         label: 'Type',            type: 'select', width: 130, list: 'PoleType',     group: 'Pole Works' },
  { key: 'pole_route_type',   label: 'Route Type',      type: 'select', width: 110, list: 'PoleRouteType',group: 'Pole Works' },
  { key: 'pole_permission_date', label: 'Permission',   type: 'date',   width: 115, group: 'Pole Works' },
  { key: 'pole_install_date', label: 'Install Date',    type: 'date',   width: 115, group: 'Pole Works' },
  { key: 'pole_cwc_date',     label: 'CWC Date',        type: 'date',   width: 110, group: 'Pole Works' },
  { key: 'pole_contractor',   label: 'Contractor',      type: 'select', width: 110, list: 'Contractor',   group: 'Pole Works' },
  { key: 'pole_rate',         label: 'Rate',            type: 'number', width: 80,  group: 'Pole Works' },
  { key: 'pole_paid_date',    label: 'Paid Date',       type: 'date',   width: 110, group: 'Pole Works' },
  { key: 'pole_invoice_no',   label: 'Invoice #',       type: 'text',   width: 100, group: 'Pole Works' },
  { key: 'pole_comment',      label: 'Comment',         type: 'text',   width: 150, group: 'Pole Works' },
  // Civil
  { key: 'civil_description', label: 'Description',     type: 'text',   width: 140, group: 'Civil' },
  { key: 'civil_rate',        label: 'Rate',            type: 'number', width: 80,  group: 'Civil' },
  { key: 'civil_qty',         label: 'Qty',             type: 'number', width: 60,  group: 'Civil' },
  { key: 'civil_total',       label: 'Total',           type: 'number', width: 90,  group: 'Civil' },
  { key: 'civil_invoice_no',  label: 'Invoice #',       type: 'text',   width: 100, group: 'Civil' },
  { key: 'civil_invoice_date',label: 'Invoice Date',    type: 'date',   width: 110, group: 'Civil' },
  { key: 'civil_comment',     label: 'Comment',         type: 'text',   width: 140, group: 'Civil' },
  // Stringing
  { key: 'stringing_description', label: 'Description', type: 'text',   width: 140, group: 'Stringing' },
  { key: 'stringing_rate',    label: 'Rate',            type: 'number', width: 80,  group: 'Stringing' },
  { key: 'stringing_qty',     label: 'Qty',             type: 'number', width: 60,  group: 'Stringing' },
  { key: 'stringing_total',   label: 'Total',           type: 'number', width: 90,  group: 'Stringing' },
  { key: 'stringing_invoice_no', label: 'Invoice #',    type: 'text',   width: 100, group: 'Stringing' },
  { key: 'stringing_date',    label: 'Date',            type: 'date',   width: 110, group: 'Stringing' },
  { key: 'stringing_comment', label: 'Comment',         type: 'text',   width: 140, group: 'Stringing' },
  // Home
  { key: 'signup_date',       label: 'Sign-up Date',    type: 'date',   width: 115, group: 'Home' },
  { key: 'home_install_date', label: 'Install Date',    type: 'date',   width: 115, group: 'Home' },
  { key: 'home_contractor',   label: 'Contractor',      type: 'select', width: 110, list: 'Contractor', group: 'Home' },
  { key: 'home_rate',         label: 'Rate',            type: 'number', width: 80,  group: 'Home' },
  { key: 'home_paid_date',    label: 'Paid Date',       type: 'date',   width: 110, group: 'Home' },
  { key: 'home_invoice_no',   label: 'Invoice #',       type: 'text',   width: 100, group: 'Home' },
  // Activation
  { key: 'activation_code',   label: 'Code',            type: 'text',   width: 130, group: 'Activation' },
  { key: 'activation_date',   label: 'Date',            type: 'date',   width: 110, group: 'Activation' },
  { key: 'activation_team',   label: 'Team',            type: 'select', width: 90,  list: 'ActivationTeam', group: 'Activation' },
  { key: 'activation_rate',   label: 'Rate',            type: 'number', width: 80,  group: 'Activation' },
  { key: 'activation_paid_date', label: 'Paid Date',    type: 'date',   width: 110, group: 'Activation' },
  { key: 'activation_invoice_no', label: 'Invoice #',   type: 'text',   width: 100, group: 'Activation' },
  { key: 'remittance',        label: 'Remittance',      type: 'text',   width: 100, group: 'Activation' },
  { key: 'remittance_date',   label: 'Remittance Date', type: 'date',   width: 120, group: 'Activation' },
  // CWC QA
  { key: 'cwc_pole_status',   label: 'Pole Status',     type: 'select', width: 110, list: 'CWCStatus', group: 'CWC QA' },
  { key: 'cwc_stringing_status', label: 'Stringing Status', type: 'select', width: 130, list: 'CWCStatus', group: 'CWC QA' },
  { key: 'cwc_qa_submit_date',label: 'QA Submit',       type: 'date',   width: 110, group: 'CWC QA' },
  { key: 'cwc_qa_approved_date', label: 'QA Approved',  type: 'date',   width: 115, group: 'CWC QA' },
  { key: 'qa_home_recon_no',  label: 'Home Recon #',    type: 'text',   width: 110, group: 'CWC QA' },
  // Optical
  { key: 'exfo_exchange',     label: 'Exfo Exchange',   type: 'text',   width: 120, group: 'Optical' },
  { key: 'optical_contractor',label: 'Contractor',      type: 'select', width: 110, list: 'Contractor', group: 'Optical' },
  { key: 'optical_type',      label: 'Type',            type: 'select', width: 90,  list: 'OpticalType', group: 'Optical' },
  { key: 'optical_splitter',  label: 'Splitter',        type: 'select', width: 90,  list: 'OpticalSplitter', group: 'Optical' },
  { key: 'optical_prepping',  label: 'Prepping',        type: 'date',   width: 110, group: 'Optical' },
  { key: 'optical_splicing',  label: 'Splicing',        type: 'date',   width: 110, group: 'Optical' },
  { key: 'qa_photos_loaded',  label: 'QA Photos',       type: 'checkbox', width: 80, group: 'Optical' },
  { key: 'atp_qa_submit_date',label: 'ATP Submit',      type: 'date',   width: 110, group: 'Optical' },
  { key: 'atp_qa_approved_date', label: 'ATP Approved', type: 'date',   width: 115, group: 'Optical' },
  { key: 'testing_status',    label: 'Testing Status',  type: 'select', width: 110, list: 'TestingStatus', group: 'Optical' },
  { key: 'test_submitted',    label: 'Test Submitted',  type: 'date',   width: 120, group: 'Optical' },
  { key: 'olt_port_activation',label: 'OLT Port',       type: 'text',   width: 130, group: 'Optical' },
  { key: 'olt_port_activated',label: 'OLT Activated',   type: 'date',   width: 120, group: 'Optical' },
  // Status
  { key: 'pon_status',        label: 'PON Status',      type: 'select', width: 100, list: 'PonStatus', group: 'Status' },
  { key: 'optical_rate',      label: 'Optical Rate',    type: 'number', width: 100, group: 'Status' },
  { key: 'optical_invoice_date', label: 'Optical Inv Date', type: 'date', width: 130, group: 'Status' },
  { key: 'optical_invoice_no',label: 'Optical Inv #',   type: 'text',   width: 120, group: 'Status' },
];

const GROUP_COLORS: Record<string, string> = {
  'Identity':   'bg-slate-700',
  'Pole Works': 'bg-blue-900/60',
  'Civil':      'bg-purple-900/60',
  'Stringing':  'bg-teal-900/60',
  'Home':       'bg-green-900/60',
  'Activation': 'bg-yellow-900/40',
  'CWC QA':     'bg-orange-900/60',
  'Optical':    'bg-cyan-900/50',
  'Status':     'bg-red-900/40',
};

interface Props {
  onDeleteRow?: (idx: number) => void;
  rows: MasterRow[];
  editMode: boolean;
  selectLists: Record<string, string[]>;
  onChange: (rows: MasterRow[]) => void;
}

export function MasterTrackerTable({ rows, editMode, selectLists, onChange, onDeleteRow }: Props) {
  function updateCell(idx: number, key: keyof MasterRow, value: unknown) {
    const next = rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r));
    onChange(next);
  }

  // Build group header spans
  const groups: { label: string; span: number; color: string }[] = [];
  let lastGroup = '';
  for (const col of MASTER_COLS) {
    const g = col.group ?? '';
    if (g === lastGroup && groups.length > 0) {
      groups[groups.length - 1]!.span++;
    } else {
      groups.push({ label: g, span: 1, color: GROUP_COLORS[g] ?? 'bg-slate-700' });
      lastGroup = g;
    }
  }

  return (
    <div className="overflow-x-auto rounded border border-slate-700">
      <table className="text-xs border-collapse" style={{ minWidth: MASTER_COLS.reduce((a, c) => a + c.width, 0) }}>
        <thead className="sticky top-0 z-10">
          {/* Group header row */}
          <tr>
            {groups.map((g) => (
              <th
                key={g.label}
                colSpan={g.span}
                className={`px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-200 border-b border-slate-600 ${g.color}`}
              >
                {g.label}
              </th>
            ))}
          </tr>
          {/* Column header row */}
          <tr className="bg-slate-800 text-slate-300">
            {MASTER_COLS.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width, minWidth: c.width }}
                className="px-2 py-1.5 text-left font-medium border-b border-slate-700 whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/50">
              {MASTER_COLS.map((col) => {
                const val = row[col.key];
                if (!editMode) {
                  if (col.type === 'checkbox') {
                    return (
                      <td key={col.key} className="px-2 py-1 text-center">
                        <span className={`inline-block w-3 h-3 rounded-full ${val ? 'bg-green-500' : 'bg-slate-600'}`} />
                      </td>
                    );
                  }
                  return (
                    <td key={col.key} className="px-2 py-1 text-slate-300 truncate" style={{ maxWidth: col.width }} title={String(val ?? '')}>
                      {val != null && val !== '' ? String(val) : '—'}
                    </td>
                  );
                }
                if (col.type === 'checkbox') {
                  return (
                    <td key={col.key} className="px-2 py-1 text-center">
                      <input type="checkbox" checked={Boolean(val)} onChange={(e) => updateCell(idx, col.key, e.target.checked)} className="w-4 h-4 accent-green-500" />
                    </td>
                  );
                }
                if (col.type === 'select') {
                  const opts = selectLists[col.list ?? ''] ?? [];
                  return (
                    <td key={col.key} className="px-1 py-0.5">
                      <select
                        value={val != null ? String(val) : ''}
                        onChange={(e) => updateCell(idx, col.key, e.target.value || null)}
                        className="w-full bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-slate-200 focus:outline-none focus:border-blue-500"
                        style={{ minWidth: col.width - 8 }}
                      >
                        <option value="">—</option>
                        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                  );
                }
                return (
                  <td key={col.key} className="px-1 py-0.5">
                    <input
                      type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                      value={val != null ? String(val) : ''}
                      onChange={(e) => updateCell(idx, col.key, col.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || null)}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-slate-200 focus:outline-none focus:border-blue-500"
                      style={{ minWidth: col.width - 8 }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="py-12 text-center text-slate-500">
          No rows yet.{editMode ? ' Click "Add Row" to start.' : ' Enable Edit mode to add rows.'}
        </div>
      )}
    </div>
  );
}
