import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import type { DevQueueBoard, CreateDevQueueItemInput } from '@/modules/devQueue/types/devQueue';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = auth.userId;

    // Fetch all columns
    const columns = await sql`
      SELECT * FROM devQueue_columns
      ORDER BY position
    `;

    // Fetch all items with vote status for current user
    const items = await sql`
      SELECT
        wi.*,
        CASE WHEN wv.user_id IS NOT NULL THEN true ELSE false END as has_voted,
        (SELECT COUNT(*) FROM devQueue_comments WHERE item_id = wi.id) as comments_count,
        (SELECT COUNT(*) FROM devQueue_attachments WHERE item_id = wi.id) as attachments_count
      FROM devQueue_items wi
      LEFT JOIN devQueue_votes wv ON wi.id = wv.item_id AND wv.user_id = ${userId}
      ORDER BY wi.column_position, wi.created_at DESC
    `;

    // Group items by column
    const columnsWithItems = columns.map(column => ({
      ...column,
      items: items.filter((item: any) => item.status === column.name)
    }));

    const board: DevQueueBoard = {
      columns: columnsWithItems
    };

    return NextResponse.json({ success: true, data: board });
  } catch (error) {
    console.error('DevQueue GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = auth.userId;

    const body: CreateDevQueueItemInput = await req.json();
    const {
      title,
      description,
      priority = 'medium',
      effort_estimate,
      work_type = 'feature',
      business_value,
      // Agent OS Spec fields
      problem_statement,
      acceptance_criteria,
      target_module,
      test_scenarios
    } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // Get user details from auth
    const userName = auth.user?.name || 'User';

    const [newItem] = await sql`
      INSERT INTO devQueue_items (
        title, description, status, priority,
        effort_estimate, work_type, business_value,
        problem_statement, acceptance_criteria, target_module, test_scenarios,
        created_by, created_by_name
      ) VALUES (
        ${title}, ${description || null}, 'Backlog', ${priority},
        ${effort_estimate || null}, ${work_type}, ${business_value || null},
        ${problem_statement || null}, ${acceptance_criteria || null}, ${target_module || null}, ${test_scenarios || null},
        ${userId}, ${userName}
      )
      RETURNING *
    `;

    return NextResponse.json({ success: true, data: newItem }, { status: 201 });
  } catch (error) {
    console.error('DevQueue POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}

// Note: Arcjet protection can be added later with middleware
