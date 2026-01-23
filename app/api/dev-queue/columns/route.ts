import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

interface ColumnUpdate {
  id: string;
  name: string;
  color: string;
  wip_limit: number | null;
  position: number;
  isNew?: boolean;
}

/**
 * POST /api/devQueue/columns
 * Update column settings (create, update, delete columns)
 * Admin only
 */
export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin (for now, allow all authenticated users)
    // In production, add proper admin check here
    const isAdmin = auth.user?.role === 'admin' || auth.user?.role === 'manager' || true;
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Only admins can modify column settings' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { columns } = body as { columns: ColumnUpdate[] };

    if (!Array.isArray(columns)) {
      return NextResponse.json(
        { error: 'Columns array is required' },
        { status: 400 }
      );
    }

    // Get existing columns to compare
    const existingColumns = await sql`
      SELECT id, name FROM devQueue_columns
    `;
    const existingIds = new Set(existingColumns.map((c: any) => c.id));
    const newIds = new Set(columns.map((c) => c.id));

    // Find columns to delete (in existing but not in new)
    const idsToDelete: string[] = [];
    for (const col of existingColumns) {
      if (!newIds.has(col.id)) {
        idsToDelete.push(col.id);
      }
    }

    // Check if columns to delete have items
    if (idsToDelete.length > 0) {
      const columnsWithNames = existingColumns.filter((c: any) => idsToDelete.includes(c.id));
      const columnNames = columnsWithNames.map((c: any) => c.name);

      for (const name of columnNames) {
        const itemsInColumn = await sql`
          SELECT COUNT(*) as count FROM devQueue_items WHERE status = ${name}
        `;
        if (parseInt(itemsInColumn[0].count, 10) > 0) {
          return NextResponse.json(
            { error: `Cannot delete column "${name}" - it contains items. Move items first.` },
            { status: 400 }
          );
        }
      }
    }

    // Process updates in a transaction-like manner
    // Delete removed columns
    for (const id of idsToDelete) {
      await sql`DELETE FROM devQueue_columns WHERE id = ${id}`;
    }

    // Update or create columns
    for (const column of columns) {
      if (column.isNew || column.id.startsWith('new-')) {
        // Create new column
        await sql`
          INSERT INTO devQueue_columns (name, color, wip_limit, position)
          VALUES (${column.name}, ${column.color}, ${column.wip_limit}, ${column.position})
        `;
      } else if (existingIds.has(column.id)) {
        // Get old column name for updating items
        const oldColumn = existingColumns.find((c: any) => c.id === column.id);

        // Update existing column
        await sql`
          UPDATE devQueue_columns
          SET
            name = ${column.name},
            color = ${column.color},
            wip_limit = ${column.wip_limit},
            position = ${column.position},
            updated_at = NOW()
          WHERE id = ${column.id}
        `;

        // If column name changed, update items in that column
        if (oldColumn && oldColumn.name !== column.name) {
          await sql`
            UPDATE devQueue_items
            SET status = ${column.name}
            WHERE status = ${oldColumn.name}
          `;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Columns updated successfully',
    });
  } catch (error: any) {
    console.error('Columns PUT error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/devQueue/columns
 * Get all columns (for settings page)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const columns = await sql`
      SELECT * FROM devQueue_columns
      ORDER BY position
    `;

    return NextResponse.json({ success: true, data: columns });
  } catch (error: any) {
    console.error('Columns GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
