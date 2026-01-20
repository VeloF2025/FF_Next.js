import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { itemId, targetColumn, position } = body;

    if (!itemId) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    if (!targetColumn) {
      return NextResponse.json({ error: 'Target column is required' }, { status: 400 });
    }

    // Update the item's status (column) and position
    const [updatedItem] = await sql`
      UPDATE wishlist_items
      SET
        status = ${targetColumn},
        column_position = ${position ?? 0},
        updated_at = NOW()
      WHERE id = ${itemId}
      RETURNING *
    `;

    if (!updatedItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: { item: updatedItem }
    });
  } catch (error: any) {
    console.error('Wishlist move error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
