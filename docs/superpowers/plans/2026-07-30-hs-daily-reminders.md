# H&S Daily Reminder Announcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add attendance and assigned-vehicle duties to the reusable H&S staff-announcement draft.

**Architecture:** Keep the change inside the existing rollout-pack renderer. Strengthen its unit test to treat the announcement as an ordered daily checklist while preserving all existing safety and approval language.

**Tech Stack:** TypeScript, Vitest, Markdown

## Global Constraints

- Use the exact My FibreFlow labels `Clock in`, `Daily H&S check-in`, `Daily vehicle check`, and `Clock out`.
- Keep `DRAFT — DO NOT SEND` and do not add any sending behavior.
- Preserve the truthful-declaration, pay, crew-lead, and blocked-activity guidance.

---

### Task 1: Expand the staff-announcement checklist

**Files:**
- Modify: `scripts/__tests__/hs-operational-rollout-pack.test.ts`
- Modify: `scripts/hs-operational-rollout/buildPack.ts`

**Interfaces:**
- Consumes: `buildPack(snapshot)['staff-announcement-DRAFT.md']`
- Produces: An ordered four-step daily checklist in the generated Markdown draft.

- [ ] **Step 1: Write the failing regression test**

Replace the announcement assertion with checks for the four exact labels and
their order:

```typescript
const clockIn = draft.indexOf('**Clock in**');
const hsCheckin = draft.indexOf('**Daily H&S check-in**');
const vehicleCheck = draft.indexOf('**Daily vehicle check**');
const clockOut = draft.indexOf('**Clock out**');

expect(clockIn).toBeGreaterThan(-1);
expect(hsCheckin).toBeGreaterThan(clockIn);
expect(vehicleCheck).toBeGreaterThan(hsCheckin);
expect(clockOut).toBeGreaterThan(vehicleCheck);
expect(draft).toContain('assigned a vehicle');
expect(draft).toContain('pre-trip check is due');
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run scripts/__tests__/hs-operational-rollout-pack.test.ts
```

Expected: FAIL because the current draft does not contain the clock-out or
assigned-vehicle reminder.

- [ ] **Step 3: Add the chronological checklist**

In `renderAnnouncement`, add:

```markdown
Every working day in **My FibreFlow**:

1. **Clock in** at the start of your shift.
2. Complete **Daily H&S check-in** after clocking in and before field work.
3. If you are assigned a vehicle, complete **Daily vehicle check** when the pre-trip check is due and before using the vehicle.
4. **Clock out** at the end of your shift.
```

Keep all existing safety and approval paragraphs below the checklist.

- [ ] **Step 4: Run focused and repository verification**

Run:

```bash
npx vitest run scripts/__tests__/hs-operational-rollout-pack.test.ts
npm run ci:quick
```

Expected: both commands exit successfully.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-30-hs-daily-reminders-design.md \
  docs/superpowers/plans/2026-07-30-hs-daily-reminders.md \
  scripts/__tests__/hs-operational-rollout-pack.test.ts \
  scripts/hs-operational-rollout/buildPack.ts
git commit -m "feat(hs): add daily attendance and vehicle reminders"
```
