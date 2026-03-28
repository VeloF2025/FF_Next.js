/**
 * DevOps DB Schema Explorer API
 * GET /api/devops/schema - Fetch database schema with tables, columns, and FK relationships
 */

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getAuth } from '@/lib/auth-mock';

const sql = neon(process.env.DATABASE_URL!);

// Cache for schema data
let schemaCache: SchemaData | null = null;
let lastRefresh: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyReferences?: {
    table: string;
    column: string;
  };
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  primaryKey: string | null;
  foreignKeys: Array<{
    columnName: string;
    referencedTable: string;
    referencedColumn: string;
  }>;
  module: string;
  isSingleColumn: boolean;
}

interface SchemaData {
  tables: TableInfo[];
  stats: {
    totalTables: number;
    totalColumns: number;
    totalForeignKeys: number;
    isolatedTables: number;
  };
  lastRefreshed: string;
}

async function fetchSchemaData(): Promise<SchemaData> {
  const now = Date.now();

  // Return cached data if still valid
  if (schemaCache && now - lastRefresh < CACHE_TTL) {
    return schemaCache;
  }

  // Fetch everything in 3 bulk queries instead of per-table loops
  const [allColumns, allPrimaryKeys, allForeignKeys] = await Promise.all([
    sql`
      SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `,
    sql`
      SELECT t.relname AS table_name, a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE i.indisprimary AND n.nspname = 'public'
    `,
    sql`
      SELECT
        kcu1.table_name,
        kcu1.column_name,
        ccu2.table_name AS referenced_table,
        ccu2.column_name AS referenced_column
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu1 ON kcu1.constraint_name = rc.constraint_name
      JOIN information_schema.constraint_column_usage ccu2 ON ccu2.constraint_name = rc.unique_constraint_name
      WHERE kcu1.table_schema = 'public'
    `,
  ]);

  // Index PKs and FKs by table name for fast lookup
  const pkByTable = new Map<string, string>();
  for (const pk of allPrimaryKeys) {
    pkByTable.set(pk.table_name as string, pk.column_name as string);
  }

  const fkByTable = new Map<string, Array<{ column_name: string; referenced_table: string; referenced_column: string }>>();
  for (const fk of allForeignKeys) {
    const tbl = fk.table_name as string;
    if (!fkByTable.has(tbl)) fkByTable.set(tbl, []);
    fkByTable.get(tbl)!.push({
      column_name: fk.column_name as string,
      referenced_table: fk.referenced_table as string,
      referenced_column: fk.referenced_column as string,
    });
  }

  // Group columns by table
  const columnsByTable = new Map<string, typeof allColumns>();
  for (const col of allColumns) {
    const tbl = col.table_name as string;
    if (!columnsByTable.has(tbl)) columnsByTable.set(tbl, []);
    columnsByTable.get(tbl)!.push(col);
  }

  // Build table infos
  const tableNames = Array.from(columnsByTable.keys()).sort();
  let totalColumns = 0;
  let totalForeignKeys = 0;

  const tableInfos: TableInfo[] = tableNames.map((tableName) => {
    const columns = columnsByTable.get(tableName) || [];
    const primaryKey = pkByTable.get(tableName) || null;
    const foreignKeys = fkByTable.get(tableName) || [];

    const columnInfos: ColumnInfo[] = columns.map((col: any) => {
      const fk = foreignKeys.find((f) => f.column_name === col.column_name);
      return {
        name: col.column_name,
        dataType: col.data_type,
        nullable: col.is_nullable === 'YES',
        defaultValue: col.column_default,
        isPrimaryKey: col.column_name === primaryKey,
        isForeignKey: !!fk,
        foreignKeyReferences: fk
          ? { table: fk.referenced_table, column: fk.referenced_column }
          : undefined,
      };
    });

    totalColumns += columnInfos.length;
    totalForeignKeys += foreignKeys.length;

    const module = tableName.split('_')[0] || 'other';

    return {
      name: tableName,
      columns: columnInfos,
      primaryKey,
      foreignKeys: foreignKeys.map((fk) => ({
        columnName: fk.column_name,
        referencedTable: fk.referenced_table,
        referencedColumn: fk.referenced_column,
      })),
      module,
      isSingleColumn: columnInfos.length === 1,
    };
  });

  // Calculate isolated tables (no FK relationships)
  const referencedTables = new Set(allForeignKeys.map((fk) => fk.referenced_table as string));
  const isolatedTables = tableInfos.filter(
    (t) => t.foreignKeys.length === 0 && !referencedTables.has(t.name)
  ).length;

  const schemaData: SchemaData = {
    tables: tableInfos,
    stats: {
      totalTables: tableInfos.length,
      totalColumns,
      totalForeignKeys,
      isolatedTables,
    },
    lastRefreshed: new Date().toISOString(),
  };

  // Update cache
  schemaCache = schemaData;
  lastRefresh = now;

  return schemaData;
}

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    const userRole = auth?.user?.role;

    // Admin-only check
    if (userRole !== 'admin') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const refresh = searchParams.get('refresh') === 'true';

    if (refresh) {
      // Clear cache to force refresh
      schemaCache = null;
      lastRefresh = 0;
    }

    const schemaData = await fetchSchemaData();

    return NextResponse.json({
      success: true,
      data: schemaData,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch schema data',
          details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
        },
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return NextResponse.json(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
