# Zone Delivery and Handover Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unused QA Centre dashboard with an audited, gate-driven zone register that measures every included PON from civil completion through technical go-live and automatically hands over a zone only when both Zone QA approvals, all handover snags, FAC, and CAC are complete.

**Architecture:** Extend canonical `pon_stage_tracking` rows with supervised delivery state, calculate all gates/statuses server-side, and expose one read model to the register and zone workspace. Command services enforce RBAC, prerequisites, optimistic locking, evidence, and append-only audit inside PostgreSQL transactions; VF Storage holds certificate/test-pack bytes.

**Tech Stack:** Next.js Pages Router, React 18, TypeScript, `pg.Pool`, PostgreSQL 15, VF Storage/formidable, Vitest, docker-backed Vitest, Playwright, Tailwind, existing `ModuleNav` and RBAC.

## Global Constraints

- Work only in `/home/hein/Workspace/FF_Next.js-zone-handover` on `feat/zone-handover-register`; never edit deploy directories or master.
- Migration number is `470`; immediately before Task 2, run `ls scripts/migrations/sql | sort -V | tail`. If another change has claimed 470, rename both 470 files and all references to the next free number before writing code.
- Do not run `npm run db:migrate`, any SQL against the shared dev/production database, or any deploy command. Design approval is not migration or deployment approval.
- Use `@/lib/db`, `apiResponse`, `log`, flat API routes, `ModuleNav`, files under 300 lines, and components under 200 lines. No sidebar subtree, `console.log`, fake tests, customer-activation gate, second PON master, or manual handover toggle.
- Seed full action access only for `super_admin` and `admin`. Construction, testing, operations, QA, and document authorities receive separate user overrides through existing RBAC administration; do not collapse them into runtime roles.
- After every task: run the named focused tests, inspect `git diff --check`, then commit only that task.

---

### Task 1: Freeze the domain contract and lifecycle calculator

**Files:**
- Create: `src/modules/construction-qa/zone-delivery/types/zoneDelivery.types.ts`
- Create: `src/modules/construction-qa/zone-delivery/services/zoneDeliveryCalculator.ts`
- Create: `src/modules/construction-qa/zone-delivery/services/__tests__/zoneDeliveryCalculator.test.ts`

**Interfaces:**
- Consumes: approved lifecycle rules only; no runtime dependency.
- Produces: the types below and `calculateZoneDelivery(input): ZoneDeliveryCalculation` for every server/UI read model.
- [ ] Write failing table-driven tests for zero/unapproved scope, excluded/cancelled PONs, every PON gate, mixed progress, separate QA, missing FAC/CAC, open snags, handed-over precedence, and post-handover terminal state.

```ts
expect(calculateZoneDelivery({
  scopeApproved: false, pons: [], civilQa: 'not_started', opticalQa: 'not_started',
  hasFac: false, hasCac: false, openBlockingSnags: 0, handedOverAt: null,
})).toMatchObject({
  status: 'scope_pending', eligibleForZoneQa: false, eligibleForHandover: false,
});
```

- [ ] Run `npm test -- --run src/modules/construction-qa/zone-delivery/services/__tests__/zoneDeliveryCalculator.test.ts` and confirm module-not-found/failing assertions.
- [ ] Define DTOs around these exact unions; command inputs carry `expectedRowVersion`, `effectiveAt`, `source`, and `reason`.

```ts
type ScopeStatus = 'included' | 'excluded' | 'cancelled';
type PonMilestone = 'civil_complete' | 'optical_complete' | 'testing_passed'
  | 'port_submitted' | 'port_approved' | 'technically_live';
type ZoneQaDiscipline = 'civil' | 'optical';
type ZoneQaStatus = 'not_started' | 'in_progress' | 'passed' | 'failed';
type ZoneDeliveryStatus = 'handed_over' | 'scope_pending' | 'handover_blocked'
  | 'zone_qa_in_progress' | 'ready_for_zone_qa' | 'go_live_in_progress'
  | 'awaiting_port_approval' | 'ready_for_port_submission'
  | 'testing_in_progress' | 'optical_construction' | 'civil_construction';
interface ZoneKey { projectId: string; zoneNo: number }
interface DeliveryActor { userId: string; email: string; permission: string }
interface CommandMeta { expectedRowVersion: number; effectiveAt: string; source: string; reason?: string }
interface UpdateScopeInput extends ZoneKey, CommandMeta {
  pons: Array<{ ponStageId: string; scopeStatus: ScopeStatus; reason?: string }>;
}
interface ConfirmMilestoneInput extends ZoneKey, CommandMeta {
  ponStageId: string; milestone: PonMilestone; action: 'confirm' | 'reopen' | 'link_maintenance';
  snagId?: string; affectedGate?: PonMilestone;
}
interface RecordZoneQaInput extends ZoneKey, CommandMeta {
  discipline: ZoneQaDiscipline; status: Exclude<ZoneQaStatus, 'not_started'>;
  notes: string; snagIds: string[];
}
interface RegisterDocumentInput extends ZoneKey, CommandMeta {
  documentType: 'test_pack' | 'fac' | 'cac'; ponStageId?: string;
  documentSource: 'vf_storage' | 'exfo_result'; sourceRef: string; filename: string;
  mimeType: string; sizeBytes: number; checksumSha256: string;
}
interface DeliveryBlocker { code: string; message: string; ponNo?: number; entityId?: string }
interface MilestoneEvidence { effectiveAt: string; actorEmail: string; source: string; reconfirmedAt?: string }
interface PonDeliveryView { ponStageId: string; ponNo: number; scopeStatus: ScopeStatus; milestones: Partial<Record<PonMilestone, MilestoneEvidence>>; rowVersion: number }
interface ZoneDeliveryActivity { id: string; action: string; effectiveAt: string; recordedAt: string; actorEmail: string; permission: string; source: string; reason: string | null; previousValue: unknown; newValue: unknown }
interface ZoneQaView { status: ZoneQaStatus; effectiveAt: string | null; approverEmail: string | null; notes: string }
interface ZoneDocumentView { id: string; documentType: 'test_pack' | 'fac' | 'cac'; ponStageId?: string; url: string; checksumSha256: string; active: boolean }
interface ZoneDeliveryView extends ZoneKey { projectName: string; pons: PonDeliveryView[]; civilQa: ZoneQaView; opticalQa: ZoneQaView; documents: ZoneDocumentView[]; status: ZoneDeliveryStatus; blockers: DeliveryBlocker[]; eligibleForZoneQaAt: string | null; handedOverAt: string | null; rowVersion: number }
interface ZoneRegisterFilters { projectId?: string; zoneNo?: number; status?: ZoneDeliveryStatus; blocker?: string; handover?: 'pending' | 'complete'; search?: string }
interface ZoneRegisterRow extends ZoneKey { projectName: string; status: ZoneDeliveryStatus; includedPons: number; livePons: number; earliestIncompleteGate: PonMilestone | null; blockerCount: number; civilQa: ZoneQaStatus; opticalQa: ZoneQaStatus; handedOverAt: string | null }
interface ZoneRegisterResult { rows: ZoneRegisterRow[]; summary: { zones: number; includedPons: number; livePons: number; readyForQa: number; handedOver: number } }
interface ZoneDeliveryInput { scopeApproved: boolean; pons: PonDeliveryView[]; civilQa: ZoneQaStatus; opticalQa: ZoneQaStatus; hasFac: boolean; hasCac: boolean; openBlockingSnags: number; handedOverAt: string | null }
interface ZoneDeliveryCalculation { status: ZoneDeliveryStatus; earliestIncompleteGate: PonMilestone | null; blockers: DeliveryBlocker[]; eligibleForZoneQa: boolean; eligibleForHandover: boolean }
```
- [ ] Implement one pure entry point and downstream-first precedence:

```ts
export function calculateZoneDelivery(
  input: ZoneDeliveryInput,
): ZoneDeliveryCalculation;
```

- [ ] Make all Task 1 tests pass, run `npm run type-check`, then commit `feat(zone-delivery): add lifecycle calculator`.
### Task 2: Add the additive schema, rollback, RBAC, and isolated DB fixture

**Files:**
- Create: `scripts/migrations/sql/470_zone_delivery_handover.sql`
- Create: `scripts/migrations/sql/rollback_470_zone_delivery_handover.sql`
- Create: `tests/db/setup/zone-delivery-seed.sql`
- Modify: `tests/db/setup/global-setup.ts`
- Create: `tests/db/zone-delivery/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 enum values and canonical `pon_stage_tracking(id, project_id, zone_no, pon_no)`.
- Produces: five tables and the six RBAC keys consumed by Task 3.
- [ ] Write failing DB assertions for five tables, unique/FK/check constraints, `row_version`, append-only activity protection, one active document per type/owner, indexes, and all six exact permission keys from the approved design.

```ts
expect(permissionRows.map(({ key }) => key).sort()).toEqual([
  'construction-qa.zone-delivery.construction-confirm',
  'construction-qa.zone-delivery.documents-manage',
  'construction-qa.zone-delivery.operations-confirm',
  'construction-qa.zone-delivery.scope-manage',
  'construction-qa.zone-delivery.testing-confirm',
  'construction-qa.zone-delivery.zone-qa-approve',
]);
```
- [ ] Run `npm run test:db -- tests/db/zone-delivery/schema.test.ts` and confirm the missing-schema failure.
- [ ] Add minimal production-shaped seed tables for `pon_stage_tracking`, `snags`, `access_permissions`, `role_permissions`, and `user_permission_overrides`; load the seed and migration only in the Docker test setup.
- [ ] Create `pon_delivery_state`, `zone_delivery_state`, `zone_delivery_documents`, `zone_delivery_snag_links`, and `zone_delivery_activity`. Enforce reasons for excluded/cancelled scope, document ownership (`test_pack` requires PON; `fac|cac` requires zone only), immutable `handed_over_at`, and `ON DELETE RESTRICT` for audit evidence.
- [ ] Insert the six `construction-qa.zone-delivery.*` action permissions under `construction-qa.qa-centre`; grant all actions only to `super_admin`/`admin`. Make the migration idempotent.
- [ ] Write rollback in dependency order, remove seeded permissions, and clear its exact `schema_migrations.filename`; never execute it outside Docker tests.
- [ ] Run the forward migration twice in the schema test, run rollback once, reapply once, then pass `npm run test:db -- tests/db/zone-delivery/schema.test.ts` and commit `feat(zone-delivery): add audited delivery schema`.
### Task 3: Build transactional repositories and command service

**Files:**
- Create: `src/modules/construction-qa/zone-delivery/repositories/zoneDeliveryReadRepository.ts`
- Create: `src/modules/construction-qa/zone-delivery/repositories/zoneDeliveryWriteRepository.ts`
- Create: `src/modules/construction-qa/zone-delivery/services/zoneDeliveryErrors.ts`
- Create: `src/modules/construction-qa/zone-delivery/services/zoneDeliveryHandover.ts`
- Create: `src/modules/construction-qa/zone-delivery/services/zoneDeliveryService.ts`
- Create: `tests/db/zone-delivery/ponMilestones.lifecycle.test.ts`
- Create: `tests/db/zone-delivery/zoneHandover.lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts and Task 2 tables through `pg.Pool`/`PoolClient`.
- Produces: the `ZoneDeliveryService` interface below; API handlers must not query delivery tables directly.
- [ ] Write failing integration tests for scope approval/exclusion/cancellation, sequence rejection, test-pack evidence, stale versions, correction/backdating reasons and old/new audit, independent QA, defect reopen/reconfirm, linked-snag closure, document supersession, one-time concurrent handover with exact scope/milestone/QA/document-checksum/snag snapshot, and post-handover maintenance linkage without reversal.

```ts
await expect(service.confirmPonMilestone(testingWithoutPack, tester))
  .rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
expect((await service.getZone(zoneKey)).handedOverAt).toBeNull();
```
- [ ] Run `npm run test:db -- tests/db/zone-delivery/ponMilestones.lifecycle.test.ts tests/db/zone-delivery/zoneHandover.lifecycle.test.ts` and confirm failures before service code exists.
- [ ] Implement repository reads/writes using a caller-supplied `PoolClient`, parameterized SQL, `FOR UPDATE`, and `UPDATE ... WHERE row_version = $expected RETURNING *`.
- [ ] Implement the service interface:

```ts
export interface ZoneDeliveryService {
  getRegister(filters: ZoneRegisterFilters): Promise<ZoneRegisterResult>;
  getZone(key: ZoneKey): Promise<ZoneDeliveryView>;
  updateScope(input: UpdateScopeInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  confirmPonMilestone(input: ConfirmMilestoneInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  recordZoneQa(input: RecordZoneQaInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  registerDocument(input: RegisterDocumentInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  recalculateForSnag(snagId: string, actor: DeliveryActor): Promise<void>;
  getActivity(key: ZoneKey): Promise<ZoneDeliveryActivity[]>;
}
export function createZoneDeliveryService(pool: Pool): ZoneDeliveryService;
```

- [ ] Let milestone reopen commands require an affected gate and existing snag ID; let failed Zone QA link existing snag IDs; after handover accept only `link_maintenance`, stored non-blocking without reversing dates. After every relevant write, calculate under the same transaction; if handover gates pass, lock the zone, stamp once, persist the full evidence snapshot, and append exactly one `zone_handed_over` activity row.
- [ ] Verify complete approved `construction_qa_reviews` scope for the matching discipline before construction confirmation, stamp Zone-QA eligibility only on its first false-to-true transition, and preserve the original timestamp through later reconfirmation.
- [ ] Return typed `ZoneDeliveryError` codes for `SCOPE_REQUIRED`, `PREREQUISITE_BLOCKED`, `EVIDENCE_REQUIRED`, `VERSION_CONFLICT`, `HANDOVER_LOCKED`, and `VALIDATION_ERROR`.
- [ ] Pass the lifecycle suite plus Task 1 tests, then commit `feat(zone-delivery): enforce audited handover workflow`.

### Task 4: Expose flat, permission-gated APIs and safe document storage

**Files:**
- Create: `src/modules/construction-qa/zone-delivery/services/zoneDeliveryDocumentStorage.ts`
- Create: `src/modules/construction-qa/zone-delivery/services/__tests__/zoneDeliveryDocumentStorage.test.ts`
- Create: `pages/api/zone-delivery/register.ts`
- Create: `pages/api/zone-delivery/zone.ts`
- Create: `pages/api/zone-delivery/scope.ts`
- Create: `pages/api/zone-delivery/pon-milestone.ts`
- Create: `pages/api/zone-delivery/zone-qa.ts`
- Create: `pages/api/zone-delivery/document.ts`
- Create: `pages/api/zone-delivery/activity.ts`
- Create: `tests/api/zone-delivery/readRoutes.test.ts`
- Create: `tests/api/zone-delivery/commandRoutes.test.ts`
- Create: `tests/api/zone-delivery/documentRoute.test.ts`
- Modify: `pages/api/snags/index.ts`
- Modify: `pages/api/snags/__tests__/handlePost.test.ts`

**Interfaces:**
- Consumes: `ZoneDeliveryService`, `RegisterDocumentInput`, `DeliveryActor`, and existing `apiResponse`/`withAuth`/`withPermission`.
- Produces: the seven approved HTTP routes returning `{ success: true, data }` or stable structured errors.

- [ ] Write failing storage tests for PDF/DOCX/XLSX magic bytes, 50 MB limit, sanitized filename, SHA-256, VF failure with no metadata write, and superseding only after successful upload.
- [ ] Write failing route tests for method, auth, each exact permission/action, query/body validation, structured blocker payloads, and `409 VERSION_CONFLICT`; add a snag PATCH regression proving a linked status change invokes zone recalculation.
- [ ] Implement JSON parsing helpers and map service errors through `apiResponse`; wrap reads with `construction-qa.qa-centre:view` and commands with their matching action permission using `edit`.

```ts
const COMMAND_PERMISSIONS = {
  scope: 'construction-qa.zone-delivery.scope-manage',
  construction: 'construction-qa.zone-delivery.construction-confirm',
  testing: 'construction-qa.zone-delivery.testing-confirm',
  operations: 'construction-qa.zone-delivery.operations-confirm',
  zoneQa: 'construction-qa.zone-delivery.zone-qa-approve',
  document: 'construction-qa.zone-delivery.documents-manage',
} as const;
```
- [ ] Implement multipart `POST /api/zone-delivery/document` for PDF/DOCX/XLSX `test_pack|fac|cac`, plus JSON registration for an existing `exfo_result`; use `vfStorage.uploadFile(buffer, 'zone-delivery', 'documents', safeName)`.
- [ ] Ensure upload response/metadata contains `source`, `sourceRef`, filename, MIME, size, checksum, effective date, uploader, and superseded document ID. Log failures without file contents.
- [ ] On database registration failure, delete the just-uploaded VF object; after a snag PATCH, call `recalculateForSnag` with the authenticated actor without changing existing snag semantics.
- [ ] Pass `npm test -- --run tests/api/zone-delivery pages/api/snags/__tests__/handlePost.test.ts src/modules/construction-qa/zone-delivery/services/__tests__/zoneDeliveryDocumentStorage.test.ts`, then commit `feat(zone-delivery): add lifecycle APIs and evidence uploads`.

### Task 5: Replace QA Centre with the operational zone register

**Files:**
- Create: `src/modules/construction-qa/zone-delivery/hooks/useZoneDeliveryRegister.ts`
- Create: `src/modules/construction-qa/zone-delivery/components/ZoneDeliveryRegisterPage.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/ZoneDeliverySummary.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/ZoneDeliveryFilters.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/ZoneDeliveryTable.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/__tests__/ZoneDeliveryRegisterPage.test.tsx`
- Modify: `pages/field-ops/index.tsx`
- Modify: `src/modules/navigation/config/modules/construction-qa.config.ts`

**Interfaces:**
- Consumes: `GET /api/zone-delivery/register` → `ZoneRegisterResult`.
- Produces: `useZoneDeliveryRegister(filters: ZoneRegisterFilters)` and row navigation to the stable zone route.
- [ ] Write failing component tests for loading, empty, error/retry, summary metrics, every filter, blocker counts, QA columns, handover date, and encoded row navigation.
- [ ] Implement the typed fetch hook with query-string filters, abort cleanup, refresh, and no browser-side gate calculation.
- [ ] Implement the dense one-row-per-zone table and summary; navigate rows to `/field-ops/zone?project_id=${encodeURIComponent(id)}&zone_no=${zoneNo}`.

```tsx
<button onClick={() => router.push(`/field-ops/zone?project_id=${encodeURIComponent(row.projectId)}&zone_no=${row.zoneNo}`)}>
  {row.projectName} Zone {row.zoneNo}
</button>
```
- [ ] Replace `FieldOpsDashboardPage` usage only; leave old project QA components untouched and unreferenced for safe rollback.
- [ ] Reorder tabs exactly: QA Centre, Works QA, OTDR Testing, Snags, Reports. Keep existing paths/RBAC keys.
- [ ] Pass the component test and `npm run type-check`, then commit `feat(zone-delivery): make QA Centre the zone register`.

### Task 6: Build the dedicated zone workspace and controlled actions

**Files:**
- Create: `src/modules/construction-qa/zone-delivery/hooks/useZoneDeliveryZone.ts`
- Create: `src/modules/construction-qa/zone-delivery/components/ZoneDeliveryWorkspacePage.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/ZoneLifecycleRail.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/PonMilestoneTable.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/ZoneQaPanels.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/HandoverEvidencePanel.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/ZoneActivityTimeline.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/ZoneDeliveryActionDialog.tsx`
- Create: `src/modules/construction-qa/zone-delivery/components/__tests__/ZoneDeliveryWorkspacePage.test.tsx`
- Create: `pages/field-ops/zone.tsx`

**Interfaces:**
- Consumes: `GET /api/zone-delivery/zone|activity` and the four command routes using Task 1 inputs.
- Produces: `useZoneDeliveryZone(key: ZoneKey)` with `zone`, `activity`, `refresh`, and typed command methods.
- [ ] Write failing tests for invalid query, all lifecycle stages, exact blockers, separate civil/optical QA, scope exceptions, backdate/source/reason fields, permission-hidden actions, stale refresh, certificates, snags, and audit old/new values.
- [ ] Implement the static page in `AppLayout` + `ModulePage`; validate `project_id` UUID and positive integer `zone_no` before fetching.
- [ ] Add deep links to Works QA, OTDR, and Snags retaining project/zone/PON query context. Display existing evidence; never infer supervised confirmation from it.
- [ ] Gate controls with `usePermission`; always show server-provided disabled reasons. Commands send `expectedRowVersion` and refetch only after confirmed success.

```tsx
const canConfirmTest = can('construction-qa.zone-delivery.testing-confirm', 'edit');
<button disabled={!canConfirmTest || blocker !== undefined} title={blocker?.message}>Confirm testing</button>
```
- [ ] Split components before either 200 lines; pass workspace tests and `npm run type-check`, then commit `feat(zone-delivery): add audited zone workspace`.

### Task 7: Verify the complete user journey and maintain module documentation

**Files:**
- Create: `tests/e2e/zone-delivery.spec.ts`
- Modify: `src/modules/construction-qa/.claude.md`
- Regenerate: `src/modules/construction-qa/AGENTS.md`

**Interfaces:**
- Consumes: the public register/workspace routes and deterministic intercepted API fixtures.
- Produces: browser evidence only; intercepted tests never claim backend gate coverage.
- [ ] Write Playwright contract fixtures and tests for tab order, register filters, row deep link, PON gates, disabled reasons, separate QA, FAC/CAC, loading/empty/error, mobile width, and one automatic handover state. Label intercepted tests `@contract`.

```ts
await expect(page.getByRole('tab').allTextContents()).resolves.toEqual(
  ['QA Centre', 'Works QA', 'OTDR Testing', 'Snags', 'Reports'],
);
await expect(page.getByRole('row', { name: /Etwatwa Zone 12/ })).toContainText('8 / 9');
```
- [ ] Start `PORT=3004 npm run dev`; run `npx playwright test tests/e2e/zone-delivery.spec.ts --project=chromium`, inspect screenshots/traces, fix every product-caused failure, and stop only that dev process.
- [ ] Add the register, workspace, tables, APIs, permission keys, and “shared DB requires explicit approval” to `.claude.md`; run `node scripts/mirror-agents-md.mjs`.
- [ ] Run focused unit/API tests, `npm run test:db -- tests/db/zone-delivery`, Playwright again, `npm run antihall`, and `npm run ci:quick`. Record exact pass/fail counts and identify any pre-existing warnings.
- [ ] Run `git diff --check`, inspect `git status --short`, verify no `.env*`, credentials, generated screenshots, or ignored mockups are staged, then commit `test(zone-delivery): verify handover journey`.

### Task 8: Independent review and PR handoff

**Interfaces:**
- Consumes: all Task 1–7 commits and verification output.
- Produces: a reviewed draft PR; no migration or deployment.
- [ ] Invoke `superpowers:requesting-code-review`; compare implementation line-by-line with the approved design and this plan.
- [ ] Resolve every Critical/Important finding with a failing regression test first; rerun Task 7 verification.
- [ ] STOP and ask Hein separately before any shared-database migration or dev deployment. A PR can be opened without either.
- [ ] Use `gh` for the branch push and draft PR. Include migration safety, RBAC grant setup, test evidence, screenshots, rollback file, and explicit “not migrated / not deployed” status.
