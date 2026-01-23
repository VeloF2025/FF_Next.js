import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface ProgressUpdate {
  status: 'pending' | 'building' | 'complete' | 'failed';
  progress: number;
  features_total?: number;
  features_completed?: number;
  error_message?: string;
  pr_url?: string;
  harness_run_id?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;

    // Verify webhook secret
    const secret = req.headers.get('x-webhook-secret');
    if (secret !== process.env.HARNESS_TRIGGER_SECRET) {
      log.warn(`Invalid webhook secret for item ${itemId}`, 'DevQueueProgress');
      return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
    }

    const body: ProgressUpdate = await req.json();
    const { status, progress, features_total, features_completed, error_message, pr_url, harness_run_id } = body;

    // Validate required fields
    if (!status || progress === undefined) {
      return NextResponse.json(
        { error: 'status and progress are required' },
        { status: 400 }
      );
    }

    // Build update object
    const updates: Record<string, any> = {
      build_status: status,
      build_progress: Math.min(100, Math.max(0, progress)),
    };

    if (status === 'building' && !updates.build_started_at) {
      updates.build_started_at = new Date().toISOString();
    }

    if (status === 'complete' || status === 'failed') {
      updates.build_completed_at = new Date().toISOString();
    }

    if (error_message) {
      updates.build_error = error_message;
    }

    if (pr_url) {
      updates.github_pr_url = pr_url;
    }

    // Update devQueue item
    const [updatedItem] = await sql`
      UPDATE wishlist_items
      SET
        build_status = ${updates.build_status},
        build_progress = ${updates.build_progress},
        build_started_at = COALESCE(build_started_at, ${updates.build_started_at || null}::timestamp),
        build_completed_at = ${updates.build_completed_at || null}::timestamp,
        build_error = ${updates.build_error || null},
        github_pr_url = COALESCE(github_pr_url, ${updates.github_pr_url || null}),
        updated_at = NOW()
      WHERE id = ${itemId}
      RETURNING id, title, build_status, build_progress
    `;

    if (!updatedItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Log to mvp_builds table if harness_run_id provided
    if (harness_run_id) {
      await sql`
        INSERT INTO wishlist_mvp_builds (
          wishlist_item_id,
          github_issue_number,
          status,
          progress,
          features_total,
          features_completed,
          harness_run_id,
          error_message,
          completed_at
        )
        VALUES (
          ${itemId},
          0,
          ${status},
          ${progress},
          ${features_total || 0},
          ${features_completed || 0},
          ${harness_run_id},
          ${error_message || null},
          ${status === 'complete' || status === 'failed' ? new Date().toISOString() : null}::timestamp
        )
        ON CONFLICT (harness_run_id) WHERE harness_run_id IS NOT NULL
        DO UPDATE SET
          status = EXCLUDED.status,
          progress = EXCLUDED.progress,
          features_completed = EXCLUDED.features_completed,
          error_message = EXCLUDED.error_message,
          completed_at = EXCLUDED.completed_at
      `.catch(() => {
        // Ignore if unique constraint doesn't exist
      });
    }

    log.info(
      `Build progress updated for ${itemId}: ${status} (${progress}%)`,
      'DevQueueProgress'
    );

    return NextResponse.json({
      success: true,
      data: updatedItem,
    });
  } catch (error: any) {
    log.error('Progress webhook error:', error, 'DevQueueProgress');
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;

    const [item] = await sql`
      SELECT
        id, title, build_status, build_progress,
        build_started_at, build_completed_at, build_error,
        github_issue_url, github_pr_url
      FROM wishlist_items
      WHERE id = ${itemId}
    `;

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: item,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
