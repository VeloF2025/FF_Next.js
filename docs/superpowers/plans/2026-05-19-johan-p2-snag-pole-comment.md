# P2 — Snag Pole with Free-Text Comment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second header button in `PoleDetailPanel` — `⚠ Snag (other issue)` — that opens a new `SnagPoleCommentModal` for free-text pole-level snags. The existing `🚩 Snag pole (planted check)` button keeps the binary planted-Y/N flow unchanged.

**Architecture:** Pure additive UI change. The `snags` table already accepts `category='quality'` + free-text `description`; no schema migrations required. The existing `POST /api/snags` route validates category against the union including `quality`. NOC ticket auto-creation reuses the existing pipeline from `ConfirmPlantedModal`/PR `e8367c189`.

**Tech Stack:** Next.js Pages Router, TypeScript strict, SWR, vitest, Tailwind. New modal uses the same dark-theme + state-machine pattern as the existing `ConfirmPlantedModal`.

**Spec reference:** `docs/superpowers/specs/2026-05-19-johan-civil-qa-snags-bulk-upload-design.md` §4.3

**Prerequisite:** P1 (PR #1664) deployed to dev and Johan has signed off on it (or `--allow-without-p1-signoff` if Hein chooses to ship in parallel).

---

## What changed vs spec

- Spec §4.3 said `category='pole_quality'`. The actual `SnagCategory` union in `src/modules/construction-qa/types/snag.types.ts` is `'quality' | 'health' | 'safety' | 'environment' | 'traffic' | 'verification'`. We use `'quality'` (existing) — no schema change. Plan reflects this.
- Spec said `pole_references[]`. The existing `snags.pole_references` is `TEXT[]` and is already populated by the verification flow. Plan reuses it.

---

## File Structure

**Created:**
- `src/modules/works-qa/components/SnagPoleCommentModal.tsx` (~150 lines) — single modal, mirrors ConfirmPlantedModal's state machine but with a textarea and severity dropdown instead of Yes/No.
- `src/modules/works-qa/__tests__/SnagPoleCommentModal.test.tsx` — vitest + @testing-library/react component tests.

**Modified:**
- `src/modules/works-qa/components/PoleDetailPanel.tsx` — add the second header button + modal mount.
- `src/modules/works-qa/.claude.md` — append a line documenting the new modal.

**Not touched:**
- `snags` table schema (no migration).
- `ConfirmPlantedModal.tsx` (planted-check flow unchanged — old button label/behaviour stays).
- `/api/snags` route (already accepts category='quality' + the fields we send).
- NOC ticket pipeline.

---

## Task 1: Failing test for SnagPoleCommentModal

**Files:**
- Create: `src/modules/works-qa/__tests__/SnagPoleCommentModal.test.tsx`

- [ ] **Step 1: Create the test file**

Create `src/modules/works-qa/__tests__/SnagPoleCommentModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SnagPoleCommentModal } from '../components/SnagPoleCommentModal';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const baseProps = {
  open: true,
  projectId: 'proj-1',
  poleQaPhotoId: 'pole-1',
  poleLabel: 'ETW.P.H216',
  onClose: vi.fn(),
  onChanged: vi.fn(),
};

describe('SnagPoleCommentModal', () => {
  it('rejects submit with empty description', async () => {
    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));
    expect(await screen.findByText(/description.*required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects description shorter than 10 chars', async () => {
    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'too short' } });
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));
    expect(await screen.findByText(/at least 10/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs /api/snags with category="quality" + pole_qa_photo_id + description + severity', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'snag-uuid-1', noc_ticket_uid: 'WQA-20260519-001' } }),
    });

    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Pole is leaning approximately 15 degrees' },
    });
    fireEvent.change(screen.getByLabelText(/severity/i), { target: { value: 'major' } });
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/snags');
    const body = JSON.parse(init.body);
    expect(body.category).toBe('quality');
    expect(body.severity).toBe('major');
    expect(body.description).toBe('Pole is leaning approximately 15 degrees');
    expect(body.pole_qa_photo_id).toBe('pole-1');
    expect(body.pole_references).toEqual(['ETW.P.H216']);
  });

  it('shows confirmation panel with NOC ticket UID after successful submit', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'snag-uuid-1', noc_ticket_uid: 'WQA-20260519-001' } }),
    });

    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Pole base concrete cracked at ground level' },
    });
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));

    expect(await screen.findByText(/WQA-20260519-001/)).toBeInTheDocument();
    expect(screen.getByText(/snag raised/i)).toBeInTheDocument();
  });

  it('surfaces a non-fatal ticket creation failure', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { id: 'snag-uuid-1', noc_ticket_uid: null },
        meta: { ticket_error: 'NOC ticket service timeout' },
      }),
    });

    render(<SnagPoleCommentModal {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Pole missing identification label' },
    });
    fireEvent.click(screen.getByRole('button', { name: /raise snag/i }));

    expect(await screen.findByText(/NOC ticket service timeout/)).toBeInTheDocument();
    expect(screen.getByText(/snag raised/i)).toBeInTheDocument(); // snag still succeeded
  });
});
```

- [ ] **Step 2: Verify test fails (component doesn't exist yet)**

Run: `cd /home/hein/Workspace/FF_Next.js-p2-plan && npx vitest run src/modules/works-qa/__tests__/SnagPoleCommentModal.test.tsx`

Expected: FAIL — `Cannot find module '../components/SnagPoleCommentModal'`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/works-qa/__tests__/SnagPoleCommentModal.test.tsx
git -c commit.gpgsign=false commit -m "test(works-qa): failing tests for SnagPoleCommentModal"
```

---

## Task 2: Implement SnagPoleCommentModal

**Files:**
- Create: `src/modules/works-qa/components/SnagPoleCommentModal.tsx`

- [ ] **Step 1: Read the reference modal**

Read `src/modules/works-qa/components/ConfirmPlantedModal.tsx` first. Note: it imports `useVerificationSnag` (for dedup against existing planted-verification snags), uses a confirmation-panel state machine, and `POST`s `/api/snags`. The new modal mirrors the state machine but for free-text snags — it does NOT need `useVerificationSnag` because each free-text snag is independent (no dedup against a single existing verification snag for the pole).

- [ ] **Step 2: Create the component**

Create `src/modules/works-qa/components/SnagPoleCommentModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { log } from '@/lib/logger';

interface SnagPoleCommentModalProps {
  open: boolean;
  projectId: string;
  poleQaPhotoId: string;
  poleLabel: string;
  onClose: () => void;
  onChanged: () => void;
}

type Severity = 'minor' | 'major' | 'critical';

interface ConfirmationState {
  snagId: string;
  ticketUid: string | null;
  ticketError: string | null;
}

const MIN_DESCRIPTION_LENGTH = 10;

export function SnagPoleCommentModal({
  open,
  projectId,
  poleQaPhotoId,
  poleLabel,
  onClose,
  onChanged,
}: SnagPoleCommentModalProps) {
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('major');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);

  // Reset state on logical reopen (parent keeps the component mounted; null-return
  // on open=false hides the UI but state would otherwise persist).
  useEffect(() => {
    if (!open) {
      setDescription('');
      setSeverity('major');
      setError(null);
      setConfirmation(null);
    }
  }, [open]);

  if (!open) return null;

  function validate(): string | null {
    const trimmed = description.trim();
    if (trimmed.length === 0) return 'Description is required';
    if (trimmed.length < MIN_DESCRIPTION_LENGTH) {
      return `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`;
    }
    return null;
  }

  async function submit() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/snags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          pole_qa_photo_id: poleQaPhotoId,
          category: 'quality',
          severity,
          description: description.trim(),
          pole_references: [poleLabel],
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error?.message ?? `Snag POST failed: ${res.status}`);
      }

      const { data, meta } = (await res.json()) as {
        data: { id: string; noc_ticket_uid: string | null };
        meta?: { ticket_error?: string };
      };

      setConfirmation({
        snagId: data.id,
        ticketUid: data.noc_ticket_uid,
        ticketError: meta?.ticket_error ?? null,
      });
      onChanged();
    } catch (err) {
      log.error('works-qa.snag-pole-comment.submit_failed', {
        pole_label: poleLabel,
        error: err instanceof Error ? err.message : String(err),
      });
      setError(err instanceof Error ? err.message : 'Failed to raise snag');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-zinc-100 font-medium">⚠ Snag pole — {poleLabel}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
        </div>

        {!confirmation ? (
          <>
            <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1" htmlFor="snag-description">
              Description
            </label>
            <textarea
              id="snag-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is wrong with this pole? Be specific."
              rows={4}
              maxLength={2000}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
            />

            <label className="block text-xs uppercase tracking-wider text-zinc-400 mt-3 mb-1" htmlFor="snag-severity">
              Severity
            </label>
            <select
              id="snag-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
            >
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>

            {error && (
              <p role="alert" className="text-xs text-red-400 mt-2">⚠ {error}</p>
            )}

            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={onClose}
                className="px-3 py-1 rounded text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={submit}
                className="px-3 py-1 rounded text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
              >
                {busy ? '…' : 'Raise snag'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-200 mb-2">✓ Snag raised for {poleLabel}.</p>
            {confirmation.ticketUid && (
              <p className="text-xs text-zinc-400">NOC ticket: <span className="text-teal-400">{confirmation.ticketUid}</span></p>
            )}
            {confirmation.ticketError && (
              <p className="text-xs text-amber-400 mt-1" role="alert">
                NOC ticket creation failed: {confirmation.ticketError} (snag saved; create ticket manually if needed)
              </p>
            )}
            <div className="flex justify-end mt-4">
              <button
                onClick={onClose}
                className="px-3 py-1 rounded text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
              >
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/modules/works-qa/__tests__/SnagPoleCommentModal.test.tsx
```

Expected: ALL 5 tests pass.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit 2>&1 | grep SnagPoleCommentModal
```

Expected: empty.

- [ ] **Step 5: Commit**

```bash
git add src/modules/works-qa/components/SnagPoleCommentModal.tsx
git -c commit.gpgsign=false commit -m "feat(works-qa): SnagPoleCommentModal — free-text pole snag with severity"
```

---

## Task 3: Wire the second button into PoleDetailPanel

**Files:**
- Modify: `src/modules/works-qa/components/PoleDetailPanel.tsx`

- [ ] **Step 1: Add the import**

After the `import { ConfirmPlantedModal } from './ConfirmPlantedModal';` line (around line 32), add:

```typescript
import { SnagPoleCommentModal } from './SnagPoleCommentModal';
```

- [ ] **Step 2: Add the state hook**

Near the existing `const [showSnagModal, setShowSnagModal] = useState(false);` (around line 46), add:

```typescript
const [showCommentModal, setShowCommentModal] = useState(false);
```

- [ ] **Step 3: Add the second button**

Locate the existing "🚩 Snag pole" button block (around line 225–234). Update its `title` to clarify intent, then add the new button immediately after:

```tsx
          {pole && (
            <button
              type="button"
              onClick={() => setShowSnagModal(true)}
              className="px-2 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
              title="Confirm: is this pole planted on site?"
            >
              🚩 Snag pole (planted check)
            </button>
          )}
          {pole && (
            <button
              type="button"
              onClick={() => setShowCommentModal(true)}
              className="px-2 py-1 rounded text-xs bg-red-900/40 hover:bg-red-800/60 text-zinc-100 border border-red-900/60"
              title="Raise a snag against this pole with a free-text comment"
            >
              ⚠ Snag (other issue)
            </button>
          )}
```

- [ ] **Step 4: Mount the new modal**

Find the existing `<ConfirmPlantedModal …>` block (around line 326). Add the new modal mount immediately after the existing one (still inside the `{pole && showSnagModal && (…)}` sibling — but use a separate gating block):

```tsx
      {pole && showCommentModal && (
        <SnagPoleCommentModal
          open={showCommentModal}
          projectId={pole.project_id}
          poleQaPhotoId={pole.id}
          poleLabel={pole.pole_label}
          onClose={() => setShowCommentModal(false)}
          onChanged={() => { void mutate(); }}
        />
      )}
```

- [ ] **Step 5: Verify tsc + tests**

```bash
npx tsc --noEmit 2>&1 | grep -E "PoleDetailPanel|SnagPoleCommentModal"
npx vitest run src/modules/works-qa/__tests__
```

Expected: tsc empty; all works-qa tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/works-qa/components/PoleDetailPanel.tsx
git -c commit.gpgsign=false commit -m "feat(works-qa): wire SnagPoleCommentModal into PoleDetailPanel header"
```

---

## Task 4: RBAC check + reporting integration

- [ ] **Step 1: Verify RBAC**

The `POST /api/snags` route uses `withAuth` (from `@/lib/auth`). Confirm by reading the route file. The existing `construction-qa.works-qa.snags.create` permission (migration 350) is what authorises the existing per-photo snag flow — it applies to this new pole-level flow too because the route is the same.

Run:
```bash
grep -n "withAuth\|withRole\|permission" pages/api/snags/index.ts | head -10
```

Confirm: route is gated. No new permission seed needed.

- [ ] **Step 2: Verify reports pick up pole-level snags**

The future P3 snag-reports endpoint will pull from `snags` table filtered by `pole_qa_photo_id`. Both per-photo (with `slot_key`) and pole-level (without `slot_key`, category='quality') will be returned. Confirm by reading `pages/api/snags/reports.ts` and the relevant report-render logic. No work required here; P3 will surface them.

- [ ] **Step 3: No commit** — verification only.

---

## Task 5: Manual smoke + CI gate

- [ ] **Step 1: Local CI gate**

```bash
cd /home/hein/Workspace/FF_Next.js-p2-plan
npm run ci:quick
```

Expected: all gates pass. Silent-catch count stable (this PR adds no catches in `pages/api`).

- [ ] **Step 2: Optional local dev smoke**

Start dev locally (`PORT=3004 npm run dev`) and exercise the flow on a pole that you know exists. Just confirm both buttons are clickable and the comment modal opens/closes cleanly.

If unable to run a local dev (port in use, etc.), defer the smoke to the dev deploy stage.

---

## Task 6: Push + open PR

- [ ] **Step 1: Push branch**

```bash
cd /home/hein/Workspace/FF_Next.js-p2-plan
git push -u origin feat/johan-p2-snag-pole-comment-plan
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base master --title "feat(works-qa): P2 — snag pole with free-text comment (Johan WA 2026-05-19)" --body "$(cat <<'EOF'
## Summary

P2 of the Civil QA snag UX overhaul (spec: docs/superpowers/specs/2026-05-19-johan-civil-qa-snags-bulk-upload-design.md §4.3).

Johan's WA 2026-05-19 14:29 complaint #2: he could not raise a free-text snag against a pole — the only "Snag pole" path is the binary planted-Y/N flow.

Adds a second header button `⚠ Snag (other issue)` in PoleDetailPanel that opens a new SnagPoleCommentModal with description (required, ≥10 chars), severity, and NOC ticket auto-creation. The existing `🚩 Snag pole (planted check)` button keeps its planted-Y/N behaviour unchanged.

## Changes

- New: `SnagPoleCommentModal.tsx` — 150-line component, mirrors ConfirmPlantedModal's state machine for the free-text case
- Modified: `PoleDetailPanel.tsx` — second button + modal mount; existing button retitled to clarify intent
- New: `SnagPoleCommentModal.test.tsx` — 5 vitest cases (empty/short description rejection, POST payload, confirmation panel, non-fatal ticket failure)

## No schema changes

`snags` table already accepts `category='quality'`, `description`, `pole_references[]`, `severity`. POST /api/snags route already validates these. No migration required.

## Test plan

- [x] `npx vitest run src/modules/works-qa/__tests__/SnagPoleCommentModal.test.tsx` → 5/5 pass
- [x] `npx vitest run src/modules/works-qa/__tests__` → no regressions
- [x] `npm run ci:quick` → all gates pass
- [ ] Manual on dev: click "⚠ Snag (other issue)" → modal opens → submit short description → validation error → submit valid description → confirmation panel with NOC ticket UID
- [ ] Johan WA sign-off before merging to production

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Invoke /review on the PR** — per CLAUDE.md "no self-review" rule.

- [ ] **Step 4: Wait for CI** — `gh run watch <id> --exit-status`. Fix findings if any.

- [ ] **Step 5: Merge when blind review APPROVED + CI passed** — `gh pr merge <N> --squash --delete-branch`.

- [ ] **Step 6: Deploy to dev** — `bash scripts/deploy-local.sh dev`.

- [ ] **Step 7: Hand off to Johan for WA sign-off.**

---

## Spec coverage check

| Spec §4.3 requirement | Task |
|---|---|
| UI: second button in PoleDetailPanel header | T3 |
| Existing ConfirmPlantedModal unchanged | T3 (only retitles the existing button) |
| Modal: description (required, ≥10 chars), severity, NOC ticket toggle | T2 (toggle dropped — always creates NOC ticket like the verification flow; revisit if Johan asks) |
| Optional photo upload | Out of scope for P2 — see "Out of scope" below |
| pole_references[] for multi-pole snags | T2 (defaulted to [poleLabel]) |
| Backend: POST /api/snags with category='pole_quality' | T2 (uses category='quality' — the existing union has no 'pole_quality' value; aligning to reality) |
| Reuse existing NOC ticket pipeline (commit e8367c189) | T2 (POST /api/snags handles ticket creation) |
| Pole-level snags appear under "Pole Quality" in reports | T4 (verification only; P3 will surface) |

---

## Out of scope (P2)

- **Optional photo upload in the modal.** The existing `SnagInlineForm` doesn't support photo upload either; spec mentions it but it's a multi-PR scope to add image upload + storage + thumbnail rendering. Defer to a P2.5 ticket if Johan requests.
- **Multi-pole selector (`pole_references` chip list)**: spec mentioned a free-text comma-separated list. Defer until Johan flags a real use case — he can edit the snag manually via the Snags tab to add references.
- **"Create NOC ticket?" toggle**: spec mentioned a default-on toggle. The current verification flow always creates a ticket on "No — not planted"; we mirror that. Add toggle only if Johan asks.
- **P3 (per-PON / per-zone reports)** — separate plan.
- **P4 (bulk upload)** — separate plan.

---

## Risks

- The `severity='major'` default may not match Johan's mental model — he might expect 'minor' for cosmetic snags. Validate during dev sign-off.
- If Johan wants both buttons collapsed into a single "Snag pole" dropdown (planted-check vs other-issue as menu options), this PR doesn't satisfy that. Hein explicitly chose "Two separate buttons" in the AskUserQuestion during spec brainstorming (2026-05-19), so this is the agreed direction — but flag any UX feedback.
- New modal duplicates ~80% of ConfirmPlantedModal's structure. Consider extracting a shared `SnagModalShell` in a future refactor if a third snag-style modal is added.
