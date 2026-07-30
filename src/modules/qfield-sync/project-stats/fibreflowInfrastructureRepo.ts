import { query } from '@/lib/db-pool';

export type QueryRunner = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

const defaultRun: QueryRunner = query;
const NULL_STATUS = '<null>';

interface ComparableCable {
  status: string | null;
}

interface ComparableDrop {
  installationStatus: string | null;
  qcStatus: string | null;
}

export interface FibreFlowInfrastructureSnapshot {
  poles: { total: number; byStatus: Record<string, number> };
  cables: {
    total: number;
    byStatus: Record<string, number>;
    records: Map<string, ComparableCable>;
  };
  drops: {
    total: number;
    byStatus: Record<string, number>;
    qcByStatus: Record<string, number>;
    records: Map<string, ComparableDrop>;
  };
  warnings: string[];
}

type PoleStatusRow = Record<string, unknown> & {
  status: string;
  count: string | number;
};

type CableRow = Record<string, unknown> & {
  identity: string | null;
  status: string | null;
};

type DropRow = Record<string, unknown> & {
  identity: string | null;
  status: string | null;
  qc_status: string | null;
};

function increment(counts: Record<string, number>, value: string | null): void {
  const key = value ?? NULL_STATUS;
  counts[key] = (counts[key] ?? 0) + 1;
}

function normalizedIdentity(value: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

export async function getFibreFlowInfrastructure(
  projectId: string,
  run: QueryRunner = defaultRun,
): Promise<FibreFlowInfrastructureSnapshot> {
  const [poleRows, cableRows, dropRows] = await Promise.all([
    run<PoleStatusRow>(
      `SELECT COALESCE(status, '<null>') AS status, COUNT(*)::int AS count
       FROM poles WHERE project_id = $1::uuid GROUP BY status`,
      [projectId],
    ),
    run<CableRow>(
      `SELECT lower(trim(segment_id)) AS identity,
              NULLIF(trim(status), '') AS status
       FROM fibre_segments
       WHERE project_id = $1::uuid`,
      [projectId],
    ),
    run<DropRow>(
      `SELECT lower(trim(drop_number)) AS identity,
              NULLIF(trim(status), '') AS status,
              NULLIF(trim(qc_status), '') AS qc_status
       FROM drops
       WHERE project_id = $1::uuid`,
      [projectId],
    ),
  ]);

  const poleByStatus: Record<string, number> = {};
  let poleTotal = 0;
  for (const row of poleRows) {
    const count = Number(row.count);
    poleByStatus[row.status] = count;
    poleTotal += count;
  }

  const cableByStatus: Record<string, number> = {};
  const cableRecords = new Map<string, ComparableCable>();
  let blankCableIdentities = 0;
  for (const row of cableRows) {
    increment(cableByStatus, row.status);
    const identity = normalizedIdentity(row.identity);
    if (!identity) {
      blankCableIdentities += 1;
      continue;
    }
    cableRecords.set(identity, { status: row.status });
  }

  const dropByStatus: Record<string, number> = {};
  const dropQcByStatus: Record<string, number> = {};
  const dropRecords = new Map<string, ComparableDrop>();
  let blankDropIdentities = 0;
  for (const row of dropRows) {
    increment(dropByStatus, row.status);
    increment(dropQcByStatus, row.qc_status);
    const identity = normalizedIdentity(row.identity);
    if (!identity) {
      blankDropIdentities += 1;
      continue;
    }
    dropRecords.set(identity, {
      installationStatus: row.status,
      qcStatus: row.qc_status,
    });
  }

  const warnings: string[] = [];
  if (blankCableIdentities > 0) {
    warnings.push(`${blankCableIdentities} FibreFlow cable records lack a comparison identity`);
  }
  if (blankDropIdentities > 0) {
    warnings.push(`${blankDropIdentities} FibreFlow drop records lack a comparison identity`);
  }

  return {
    poles: { total: poleTotal, byStatus: poleByStatus },
    cables: {
      total: cableRows.length,
      byStatus: cableByStatus,
      records: cableRecords,
    },
    drops: {
      total: dropRows.length,
      byStatus: dropByStatus,
      qcByStatus: dropQcByStatus,
      records: dropRecords,
    },
    warnings,
  };
}
