import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import type { UpdateDevQueueItemInput } from '@/modules/dev-queue/types/devQueue';

const sql = neon(process.env.DATABASE_URL!);

/**
 * GET /api/devQueue/[id] - Get a single devQueue item with details
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = auth.userId;
    const { id } = params;

    // Fetch item with vote status
    const [item] = await sql`
      SELECT
        wi.*,
        CASE WHEN wv.user_id IS NOT NULL THEN true ELSE false END as has_voted,
        (SELECT COUNT(*) FROM wishlist_comments WHERE item_id = wi.id) as comments_count,
        (SELECT COUNT(*) FROM wishlist_attachments WHERE item_id = wi.id) as attachments_count
      FROM wishlist_items wi
      LEFT JOIN wishlist_votes wv ON wi.id = wv.item_id AND wv.user_id = ${userId}
      WHERE wi.id = ${id}
    `;

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Fetch comments
    const comments = await sql`
      SELECT * FROM wishlist_comments
      WHERE item_id = ${id}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({
      success: true,
      data: { item, comments }
    });
  } catch (error: any) {
    console.error('DevQueue GET [id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/devQueue/[id] - Update a devQueue item
 * Only the creator or admin can update
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = auth.userId;
    const isAdmin = auth.user?.role === 'admin' || auth.user?.role === 'super_admin';
    const { id } = params;

    // Check if item exists and user has permission
    const [existingItem] = await sql`
      SELECT * FROM wishlist_items WHERE id = ${id}
    `;

    if (!existingItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Check permission: only creator or admin can edit
    if (existingItem.created_by !== userId && !isAdmin) {
      return NextResponse.json(
        { error: 'You can only edit items you created' },
        { status: 403 }
      );
    }

    const body: UpdateDevQueueItemInput = await req.json();
    const {
      title,
      description,
      priority,
      effort_estimate,
      business_value,
      assigned_to,
      assigned_to_name,
      // Agent OS Spec fields
      problem_statement,
      acceptance_criteria,
      target_module,
      test_scenarios
    } = body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (title !== undefined) {
      updates.push('title');
      values.push(title);
    }
    if (description !== undefined) {
      updates.push('description');
      values.push(description);
    }
    if (priority !== undefined) {
      updates.push('priority');
      values.push(priority);
    }
    if (effort_estimate !== undefined) {
      updates.push('effort_estimate');
      values.push(effort_estimate);
    }
    if (business_value !== undefined) {
      updates.push('business_value');
      values.push(business_value);
    }
    if (assigned_to !== undefined) {
      updates.push('assigned_to');
      values.push(assigned_to);
    }
    if (assigned_to_name !== undefined) {
      updates.push('assigned_to_name');
      values.push(assigned_to_name);
    }
    // Agent OS Spec fields
    if (problem_statement !== undefined) {
      updates.push('problem_statement');
      values.push(problem_statement);
    }
    if (acceptance_criteria !== undefined) {
      updates.push('acceptance_criteria');
      values.push(acceptance_criteria);
    }
    if (target_module !== undefined) {
      updates.push('target_module');
      values.push(target_module);
    }
    if (test_scenarios !== undefined) {
      updates.push('test_scenarios');
      values.push(test_scenarios);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    // Update the item
    const [updatedItem] = await sql`
      UPDATE wishlist_items
      SET
        title = COALESCE(${title}, title),
        description = COALESCE(${description}, description),
        priority = COALESCE(${priority}, priority),
        effort_estimate = COALESCE(${effort_estimate}, effort_estimate),
        business_value = COALESCE(${business_value}, business_value),
        assigned_to = COALESCE(${assigned_to}, assigned_to),
        assigned_to_name = COALESCE(${assigned_to_name}, assigned_to_name),
        problem_statement = COALESCE(${problem_statement}, problem_statement),
        acceptance_criteria = COALESCE(${acceptance_criteria}, acceptance_criteria),
        target_module = COALESCE(${target_module}, target_module),
        test_scenarios = COALESCE(${test_scenarios}, test_scenarios),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({ success: true, data: updatedItem });
  } catch (error: any) {
    console.error('DevQueue PUT [id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/devQueue/[id] - Delete a devQueue item
 * Only the creator or admin can delete
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = auth.userId;
    const isAdmin = auth.user?.role === 'admin' || auth.user?.role === 'super_admin';
    const { id } = params;

    // Check if item exists and user has permission
    const [existingItem] = await sql`
      SELECT * FROM wishlist_items WHERE id = ${id}
    `;

    if (!existingItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Check permission: only creator or admin can delete
    if (existingItem.created_by !== userId && !isAdmin) {
      return NextResponse.json(
        { error: 'You can only delete items you created' },
        { status: 403 }
      );
    }

    // Delete related data first (cascading delete)
    await sql`DELETE FROM wishlist_votes WHERE item_id = ${id}`;
    await sql`DELETE FROM wishlist_comments WHERE item_id = ${id}`;
    await sql`DELETE FROM wishlist_attachments WHERE item_id = ${id}`;

    // Delete the item
    await sql`DELETE FROM wishlist_items WHERE id = ${id}`;

    return NextResponse.json({ success: true, message: 'Item deleted' });
  } catch (error: any) {
    console.error('DevQueue DELETE [id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
