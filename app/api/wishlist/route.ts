import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import type { WishlistBoard, CreateWishlistItemInput } from '@/modules/wishlist/types/wishlist';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return apiResponse.unauthorized();
    }
    const userId = auth.userId;

    // Fetch all columns
    const columns = await sql`
      SELECT * FROM wishlist_columns
      ORDER BY position
    `;

    // Fetch all items with vote status for current user
    const items = await sql`
      SELECT
        wi.*,
        CASE WHEN wv.user_id IS NOT NULL THEN true ELSE false END as has_voted,
        (SELECT COUNT(*) FROM wishlist_comments WHERE item_id = wi.id) as comments_count
      FROM wishlist_items wi
      LEFT JOIN wishlist_votes wv ON wi.id = wv.item_id AND wv.user_id = ${userId}
      ORDER BY wi.column_position, wi.created_at DESC
    `;

    // Group items by column
    const columnsWithItems = columns.map(column => ({
      ...column,
      items: items.filter((item: any) => item.status === column.name)
    }));

    const board: WishlistBoard = {
      columns: columnsWithItems
    };

    return apiResponse.success(board);
  } catch (error) {
    console.error('Wishlist GET error:', error);
    return apiResponse.internalError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return apiResponse.unauthorized();
    }
    const userId = auth.userId;

    const body: CreateWishlistItemInput = await req.json();
    const { title, description, priority = 'medium', effortEstimate, businessValue } = body;

    if (!title) {
      return apiResponse.badRequest('Title is required');
    }

    // Get user details from auth
    const userName = auth.user?.name || 'User';

    const [newItem] = await sql`
      INSERT INTO wishlist_items (
        title, description, status, priority,
        effort_estimate, business_value,
        created_by, created_by_name
      ) VALUES (
        ${title}, ${description}, 'Backlog', ${priority},
        ${effortEstimate || null}, ${businessValue || null},
        ${userId}, ${userName}
      )
      RETURNING *
    `;

    return apiResponse.success(newItem, 201);
  } catch (error) {
    console.error('Wishlist POST error:', error);
    return apiResponse.internalError(error);
  }
}

// Note: Arcjet protection can be added later with middleware
