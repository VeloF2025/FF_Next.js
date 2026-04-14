import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import {
  isEligibleForMvp,
  createMvpIssue,
} from '@/modules/dev-queue/services/githubMvpSync';
import {
  triggerPocValidation,
  triggerHarnessBuild,
} from '@/modules/dev-queue/services/harnessTrigger';

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

    // 2-Stage Pipeline Triggers
    let pipelineTriggered = false;
    let pipelineStage: 'poc' | 'harness' | null = null;
    let githubIssue: { issueNumber: number; issueUrl: string } | null = null;

    // Stage 1: Move to "Approved" → Create GitHub Issue + Trigger POC
    if (targetColumn === 'Approved' && isEligibleForMvp(updatedItem.effort_estimate)) {
      log.info(
        `Item ${itemId} approved with effort ${updatedItem.effort_estimate} - triggering Stage 1 (POC)`,
        undefined,
        'DevQueueMove'
      );

      // Create GitHub Issue
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
        // Update devQueue item with GitHub issue URL and POC status
        await sql`
          UPDATE wishlist_items
          SET
            github_issue_url = ${githubIssue.issueUrl},
            poc_status = 'pending',
            build_status = 'pending',
            build_progress = 0
          WHERE id = ${itemId}
        `;

        pipelineTriggered = true;
        pipelineStage = 'poc';
        log.info(
          `Stage 1 (POC) triggered for item ${itemId} - GitHub Issue #${githubIssue.issueNumber}`,
          undefined,
          'DevQueueMove'
        );

        // Trigger POC validation (async, fire and forget)
        if (process.env.HARNESS_TRIGGER_URL) {
          triggerPocValidation({
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
            log.warn(`POC trigger failed (non-blocking): ${err}`, undefined, 'DevQueueMove');
          });
        }
      } else {
        log.warn(
          `Failed to create GitHub issue for item ${itemId} - pipeline not triggered`,
          undefined,
          'DevQueueMove'
        );
      }
    }

    // Stage 2: Move to "Building" → Trigger Full Harness
    if (targetColumn === 'Building' && updatedItem.github_issue_url) {
      log.info(
        `Item ${itemId} moved to Building - triggering Stage 2 (Full Harness)`,
        undefined,
        'DevQueueMove'
      );

      // Extract issue number from URL
      const issueMatch = updatedItem.github_issue_url.match(/\/issues\/(\d+)$/);
      const issueNumber = issueMatch ? parseInt(issueMatch[1], 10) : 0;

      // Update build status
      await sql`
        UPDATE wishlist_items
        SET
          build_status = 'building',
          build_progress = 0
        WHERE id = ${itemId}
      `;

      pipelineTriggered = true;
      pipelineStage = 'harness';

      // Trigger full harness build (async, fire and forget)
      if (process.env.HARNESS_TRIGGER_URL) {
        triggerHarnessBuild({
          item_id: itemId,
          work_type: updatedItem.work_type || 'feature',
          github_issue_number: issueNumber,
          github_issue_url: updatedItem.github_issue_url,
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
          log.warn(`Harness trigger failed (non-blocking): ${err}`, undefined, 'DevQueueMove');
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        item: updatedItem,
        pipelineTriggered,
        pipelineStage,
        githubIssue: githubIssue ? {
          number: githubIssue.issueNumber,
          url: githubIssue.issueUrl,
        } : null,
      }
    });
  } catch (error: unknown) {
    log.error('DevQueue move error', { error }, 'DevQueueMove');
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
