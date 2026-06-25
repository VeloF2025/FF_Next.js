import { query as poolQuery, transaction as poolTransaction, pool } from '@/lib/db-pool';

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await poolQuery<T & Record<string, unknown>>(text, params);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await poolQuery<T & Record<string, unknown>>(text, params);
  return (rows[0] ?? null) as T | null;
}

export { poolTransaction as transaction, pool };
