interface DriverQuery {
  query: string;
  params: unknown[];
}

export interface CapturedQuery {
  text: string;
  params: unknown[];
}

type PermissionResult = 'allow' | 'deny' | 'error';
type DbValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | Record<string, boolean>;

function rawValue(value: DbValue): {
  dataTypeID: number;
  raw: string | null;
} {
  if (value === null) return { dataTypeID: 25, raw: null };
  if (typeof value === 'boolean') {
    return { dataTypeID: 16, raw: value ? 't' : 'f' };
  }
  if (typeof value === 'number') return { dataTypeID: 23, raw: String(value) };
  if (typeof value === 'object') {
    return { dataTypeID: 3802, raw: JSON.stringify(value) };
  }
  return { dataTypeID: 25, raw: value };
}

function databaseResponse(rows: Array<Record<string, DbValue>>): Response {
  const names = rows[0] ? Object.keys(rows[0]) : [];
  const fields = names.map((name) => ({
    name,
    dataTypeID: rawValue(rows[0]![name] ?? null).dataTypeID,
  }));
  const rawRows = rows.map((row) =>
    names.map((name) => rawValue(row[name] ?? null).raw));
  return new Response(JSON.stringify({
    fields,
    rows: rawRows,
    rowCount: rows.length,
    command: 'SELECT',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export class ConsentRouteDatabase {
  readonly queries: CapturedQuery[] = [];
  permissionResult: PermissionResult = 'deny';

  clear(): void {
    this.queries.length = 0;
    this.permissionResult = 'deny';
  }

  readonly fetch: typeof fetch = async (_input, init) => {
    if (typeof init?.body !== 'string') {
      throw new Error('Expected the Neon driver to send a JSON string body');
    }
    const request = JSON.parse(init.body) as DriverQuery;
    this.queries.push({ text: request.query, params: request.params });
    const normalized = request.query.replace(/\s+/g, ' ').trim();

    if (normalized.includes('INNER JOIN user_sessions')) {
      return databaseResponse([{
        id: 'route-user',
        email: 'route.user@velocityfibre.co.za',
        first_name: 'Route',
        last_name: 'User',
        role: 'admin',
        permissions: [],
        is_active: true,
        profile_picture: null,
        department: null,
        session_id: 'route-session',
        is_impersonation: false,
        kind: 'browser',
      }]);
    }
    if (normalized.includes('SELECT role, permissions FROM users WHERE id')) {
      if (this.permissionResult === 'error') {
        throw new Error('Deliberate permission database failure');
      }
      return databaseResponse([{ role: 'admin', permissions: [] }]);
    }
    if (normalized.includes('WITH RECURSIVE ancestors')) {
      return databaseResponse([]);
    }
    if (normalized.includes('FROM user_permission_overrides')) {
      return databaseResponse([]);
    }
    if (normalized.includes('FROM role_permissions')) {
      return this.permissionResult === 'allow'
        ? databaseResponse([{ actions: { view: true } }])
        : databaseResponse([]);
    }
    throw new Error(`Unexpected database query: ${normalized}`);
  };
}
