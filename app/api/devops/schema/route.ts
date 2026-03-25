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

  // Fetch all tables
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;

  const tableInfos: TableInfo[] = [];
  let totalColumns = 0;
  let totalForeignKeys = 0;

  for (const table of tables) {
    const tableName = table.table_name as string;

    // Fetch columns
    const columns = await sql`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tableName}
      ORDER BY ordinal_position
    `;

    // Fetch primary key
    const pkResult = await sql`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      JOIN pg_class t ON t.oid = i.indrelid
      WHERE t.relname = ${tableName} AND i.indisprimary
      LIMIT 1
    `;

    const primaryKey = pkResult.length > 0 ? (pkResult[0].attname as string) : null;

    // Fetch foreign keys
    const foreignKeys = await sql`
      SELECT
        kcu1.column_name,
        ccu2.table_name AS referenced_table,
        ccu2.column_name AS referenced_column
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu1 ON kcu1.constraint_name = rc.constraint_name
      JOIN information_schema.constraint_column_usage ccu2 ON ccu2.constraint_name = rc.unique_constraint_name
      WHERE kcu1.table_name = ${tableName}
    `;

    const columnInfos: ColumnInfo[] = columns.map((col: any) => {
      const fk = foreignKeys.find((f: any) => f.column_name === col.column_name);

      return {
        name: col.column_name,
        dataType: col.data_type,
        nullable: col.is_nullable === 'YES',
        defaultValue: col.column_default,
        isPrimaryKey: col.column_name === primaryKey,
        isForeignKey: !!fk,
        foreignKeyReferences: fk
          ? {
              table: fk.referenced_table,
              column: fk.referenced_column,
            }
          : undefined,
      };
    });

    totalColumns += columnInfos.length;
    totalForeignKeys += foreignKeys.length;

    // Extract module from table name (e.g., "procurement_orders" -> "procurement")
    const module = tableName.split('_')[0] || 'other';

    const tableInfo: TableInfo = {
      name: tableName,
      columns: columnInfos,
      primaryKey,
      foreignKeys: foreignKeys.map((fk: any) => ({
        columnName: fk.column_name,
        referencedTable: fk.referenced_table,
        referencedColumn: fk.referenced_column,
      })),
      module,
      isSingleColumn: columnInfos.length === 1,
    };

    tableInfos.push(tableInfo);
  }

  // Calculate isolated tables (no FK relationships)
  const isolatedTables = tableInfos.filter(
    (t) => t.foreignKeys.length === 0 && !tableInfos.some((other) =>
      other.foreignKeys.some((fk) => fk.referencedTable === t.name)
    )
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
