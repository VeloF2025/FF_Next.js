/**
 * Schema Explorer Types
 */

export interface ColumnInfo {
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

export interface TableInfo {
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

export interface SchemaStats {
  totalTables: number;
  totalColumns: number;
  totalForeignKeys: number;
  isolatedTables: number;
}

export interface SchemaData {
  tables: TableInfo[];
  stats: SchemaStats;
  lastRefreshed: string;
}

export const MODULE_COLORS: Record<string, string> = {
  procurement: '#3b82f6',
  poles: '#10b981',
  activate: '#f59e0b',
  conduit: '#8b5cf6',
  projects: '#ec4899',
  contracts: '#06b6d4',
  qfield: '#14b8a6',
  analytics: '#f97316',
  health: '#6366f1',
  other: '#6b7280',
};
