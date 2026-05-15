/**
 * E2E happy-path for the Works QA per-photo snag flow.
 *
 * Covers PRs #1633 (migration+service) → #1635 (APIs) → #1636 (UI) →
 * #1637 (counts) → #PR5 (RBAC + this test). Runs against dev.fibreflow.app
 * by default; override with E2E_BASE_URL.
 *
 * Strategy: exercise the API directly through the authenticated session
 * (storage state from tests/e2e/.auth/user.json) and confirm the
 * outstanding-snag counts on /api/works-qa/zones move as expected. This is
 * deterministic and survives UI churn — the UI-level interaction is
 * covered indirectly because the same routes back the UI.
 *
 * Requires: a project with at least one pole_qa_photo row whose photo slot
 * is filled (so the snag service has a row to attach to). If no fixture is
 * available, the test skips gracefully rather than producing a false
 * failure.
 *
 * Limitations:
 * - Uses the super_admin storage state (auth.setup.ts). withPermission
 *   short-circuits for super_admin, so this test does NOT cover the RBAC
 *   gate on .snags.create / .snags.verify — that requires a qa_manager
 *   fixture user we don't have yet.
 * - On the duplicate-snag idempotency branch (line 99), the create-side
 *   count assertion is skipped — the test then only proves the resolve
 *   path drops the count. Re-running this test against the same pole+slot
 *   without DB cleanup will always hit this branch.
 * - No teardown: resolved snags persist with status='verified'. Acceptable
 *   on dev (data is freely mutable); revisit if we ever point E2E at prod.
 */

import { test, expect } from '@playwright/test';

interface SnagPostResponse {
  status: 'created' | 'duplicate';
  snag: { id: string; description: string; severity: string; status: string; noc_ticket_id: string | null };
  ticket?: { id: string };
}

interface ZoneSummary {
  zone_no: number | null;
  pon_count: number;
  pole_count: number;
  approved_count: number;
  outstanding_snag_count: number;
  pons: { pon_no: number; pole_count: number; approved_count: number; outstanding_snag_count: number }[];
}

interface PoleSummary {
  id: string;
  pole_label: string;
  pon_no: number | null;
  outstanding_snag_count: number;
}

test.describe('Works QA snag flow', () => {
  test('create → resolve cycles outstanding_snag_count', async ({ request }) => {
    // 1. Pick a project that has at least one pole with a filled photo slot.
    const projectsRes = await request.get('/api/projects?limit=50');
    test.skip(!projectsRes.ok(), `projects API unavailable (${projectsRes.status()})`);
    const projects = await projectsRes.json();
    const projectList: Array<{ id: string }> = projects?.data ?? projects ?? [];
    test.skip(projectList.length === 0, 'no projects available on this environment');

    // Find a project that has poles AND at least one photo slot filled.
    let projectId: string | null = null;
    let candidatePole: PoleSummary | null = null;
    for (const p of projectList) {
      const polesRes = await request.get(`/api/works-qa/poles?project_id=${p.id}`);
      if (!polesRes.ok()) continue;
      const poles = await polesRes.json();
      const poleRows: PoleSummary[] = poles?.data ?? poles ?? [];
      // Pick a pole that has at least one filled photo slot; the detail
      // endpoint exposes the actual photo keys for the snag insert.
      const candidate = poleRows.find(pole => pole.pon_no !== null);
      if (candidate) {
        projectId = p.id;
        candidatePole = candidate;
        break;
      }
    }
    test.skip(!projectId || !candidatePole, 'no project with works-qa poles available');

    // 2. Fetch the pole detail to find a filled slot key.
    const detailRes = await request.get(`/api/works-qa/pole-detail?id=${candidatePole!.id}`);
    expect(detailRes.ok(), `pole-detail failed: ${detailRes.status()}`).toBeTruthy();
    const detail = await detailRes.json();
    const photo = detail?.data ?? detail;
    const slots = [
      'civil_01','civil_02','civil_03','civil_04','civil_05','civil_06','civil_07',
      'dome_01','dome_02','dome_03','dome_04','dome_05','dome_06','dome_07','dome_08',
      'main_joint_11','main_joint_12','main_joint_13','main_joint_14','main_joint_15','main_joint_16',
    ];
    const slotKey = slots.find(k => photo?.[`${k}_key`]);
    test.skip(!slotKey, 'no filled photo slot on the candidate pole');

    // 3. Baseline outstanding snag count for this pole's PON.
    const ponNo = candidatePole!.pon_no!;
    const baselineZones = await getOutstandingForPon(request, projectId!, ponNo);
    expect(baselineZones).not.toBeNull();
    const baselineCount = baselineZones!;

    // 4. Create a snag via the create endpoint.
    const createRes = await request.post('/api/works-qa/photo-snag', {
      data: {
        pole_qa_photo_id: candidatePole!.id,
        slot_key: slotKey,
        comment: `E2E snag flow test ${Date.now()}`,
        severity: 'minor',
      },
    });
    expect(createRes.ok(), `photo-snag failed: ${createRes.status()} ${await createRes.text()}`).toBeTruthy();
    const created = (await createRes.json()) as { data?: SnagPostResponse } | SnagPostResponse;
    const createdPayload: SnagPostResponse = 'data' in created && created.data ? created.data : (created as SnagPostResponse);
    expect(createdPayload.status === 'created' || createdPayload.status === 'duplicate').toBeTruthy();
    expect(createdPayload.snag.id).toBeTruthy();

    const snagId = createdPayload.snag.id;

    // 5. If we created a fresh snag (not duplicate), count should have ticked up.
    if (createdPayload.status === 'created') {
      const afterCreateCount = await getOutstandingForPon(request, projectId!, ponNo);
      expect(afterCreateCount).toBeGreaterThanOrEqual(baselineCount + 1);
    }

    // 6. Resolve the snag.
    const resolveRes = await request.post('/api/works-qa/photo-snag-resolve', {
      data: { snag_id: snagId },
    });
    expect(resolveRes.ok(), `photo-snag-resolve failed: ${resolveRes.status()} ${await resolveRes.text()}`).toBeTruthy();

    // 7. Count should be back to baseline (or lower if duplicates resolved alongside).
    const afterResolveCount = await getOutstandingForPon(request, projectId!, ponNo);
    expect(afterResolveCount).toBeLessThanOrEqual(baselineCount);
  });
});

async function getOutstandingForPon(
  request: import('@playwright/test').APIRequestContext,
  projectId: string,
  ponNo: number,
): Promise<number | null> {
  const res = await request.get(`/api/works-qa/zones?project_id=${projectId}`);
  if (!res.ok()) return null;
  const body = await res.json();
  const zones: ZoneSummary[] = body?.data ?? body ?? [];
  for (const zone of zones) {
    const pon = zone.pons.find(p => p.pon_no === ponNo);
    if (pon) return pon.outstanding_snag_count;
  }
  return null;
}
