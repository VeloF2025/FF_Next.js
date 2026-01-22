import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import {
  isEligibleForMvp,
  createMvpIssue,
} from '@/modules/wishlist/services/githubMvpSync';
import { triggerHarnessBuild } from '@/modules/wishlist/services/harnessTrigger';

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

    // MVP Pipeline Trigger: When item moves to "Approved" with XS/S/M effort
    let mvpTriggered = false;
    let githubIssue: { issueNumber: number; issueUrl: string } | null = null;

    if (targetColumn === 'Approved' && isEligibleForMvp(updatedItem.effort_estimate)) {
      log.info(
        `Item ${itemId} approved with effort ${updatedItem.effort_estimate} - triggering MVP pipeline`,
        'WishlistMove'
      );

      // Create GitHub Issue to trigger the MVP build
      githubIssue = await createMvpIssue({
        id: updatedItem.id,
        title: updatedItem.title,
        description: updatedItem.description,
        priority: updatedItem.priority,
        effort_estimate: updatedItem.effort_estimate,
        business_value: updatedItem.business_value,
        votes: updatedItem.votes,
        created_by_name: updatedItem.created_by_name,
        creator_email: updatedItem.creator_email,
        problem_statement: updatedItem.problem_statement,
        acceptance_criteria: updatedItem.acceptance_criteria,
        target_module: updatedItem.target_module,
        test_scenarios: updatedItem.test_scenarios,
      });

      if (githubIssue) {
        // Update wishlist item with GitHub issue URL and build status
        await sql`
          UPDATE wishlist_items
          SET
            github_issue_url = ${githubIssue.issueUrl},
            build_status = 'pending',
            build_progress = 0
          WHERE id = ${itemId}
        `;

        mvpTriggered = true;
        log.info(
          `MVP pipeline triggered for item ${itemId} - GitHub Issue #${githubIssue.issueNumber}`,
          'WishlistMove'
        );

        // Trigger harness build (async, fire and forget)
        if (process.env.HARNESS_TRIGGER_URL) {
          triggerHarnessBuild({
            item_id: itemId,
            work_type: updatedItem.work_type || 'feature',
            github_issue_number: githubIssue.issueNumber,
            github_issue_url: githubIssue.issueUrl,
            spec: {
              title: updatedItem.title,
              description: updatedItem.description,
              problem_statement: updatedItem.problem_statement,
              acceptance_criteria: updatedItem.acceptance_criteria,
              target_module: updatedItem.target_module,
              test_scenarios: updatedItem.test_scenarios,
              effort_estimate: updatedItem.effort_estimate,
              priority: updatedItem.priority,
            },
          }).catch((err) => {
            log.warn(`Harness trigger failed (non-blocking): ${err}`, 'WishlistMove');
          });
        }
      } else {
        log.warn(
          `Failed to create GitHub issue for item ${itemId} - MVP pipeline not triggered`,
          'WishlistMove'
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        item: updatedItem,
        mvpTriggered,
        githubIssue: githubIssue ? {
          number: githubIssue.issueNumber,
          url: githubIssue.issueUrl,
        } : null,
      }
    });
  } catch (error: any) {
    console.error('Wishlist move error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
