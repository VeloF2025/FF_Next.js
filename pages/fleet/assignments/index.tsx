import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { fleetConfig } from '@/modules/navigation';
import type { AssignmentProposalRow, AssignmentRosterEntry } from '@/modules/fleet/assignments/types';
import { assignmentApi } from '@/modules/fleet/assignments/web/assignmentApi';
import { AssignmentEditor } from '@/modules/fleet/assignments/web/AssignmentEditor';
import { AssignmentFilters, type AssignmentFilterValue } from '@/modules/fleet/assignments/web/AssignmentFilters';
import { AssignmentRoster } from '@/modules/fleet/assignments/web/AssignmentRoster';
const today = () => new Date().toISOString().slice(0, 10);
export default function AssignmentPage() { const [filters, setFilters] = useState<AssignmentFilterValue>({ from: today(), to: today(), projectId: '', siteId: '', source: '' }); const [rows, setRows] = useState<AssignmentRosterEntry[]>([]); const [selected, setSelected] = useState<string[]>([]); const [error, setError] = useState<string | null>(null); const load = useCallback(async () => { try { const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString(); setRows((await assignmentApi.roster(query)).items); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load assignments'); } }, [filters]); useEffect(() => { void load(); }, [load]); const proposals: AssignmentProposalRow[] = []; return <AppLayout><ModulePage config={fleetConfig} hideTabs><div className="p-6 space-y-4"><h1>Operational assignments</h1><AssignmentFilters value={filters} onChange={setFilters} />{error && <p role="alert">{error}</p>}<AssignmentRoster rows={rows} selected={selected} onSelect={setSelected} /><AssignmentEditor rows={proposals} onCommitted={load} /></div></ModulePage></AppLayout>; }
