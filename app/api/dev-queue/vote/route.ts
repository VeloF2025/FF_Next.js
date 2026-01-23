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
    const userId = auth.userId;

    const body = await req.json();
    const { itemId } = body;

    if (!itemId) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    // Check if user already voted
    const [existingVote] = await sql`
      SELECT id FROM wishlist_votes
      WHERE item_id = ${itemId} AND user_id = ${userId}
    `;

    let voted: boolean;
    let votes: number;

    if (existingVote) {
      // Remove vote
      await sql`
        DELETE FROM wishlist_votes
        WHERE item_id = ${itemId} AND user_id = ${userId}
      `;

      // Decrement vote count
      await sql`
        UPDATE wishlist_items
        SET votes = GREATEST(0, COALESCE(votes, 0) - 1)
        WHERE id = ${itemId}
      `;

      voted = false;
    } else {
      // Add vote
      await sql`
        INSERT INTO wishlist_votes (item_id, user_id)
        VALUES (${itemId}, ${userId})
      `;

      // Increment vote count
      await sql`
        UPDATE wishlist_items
        SET votes = COALESCE(votes, 0) + 1
        WHERE id = ${itemId}
      `;

      voted = true;
    }

    // Get updated vote count
    const [item] = await sql`
      SELECT votes FROM wishlist_items WHERE id = ${itemId}
    `;

    votes = item?.votes || 0;

    return NextResponse.json({
      success: true,
      data: { voted, votes }
    });
  } catch (error: any) {
    console.error('DevQueue vote error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
