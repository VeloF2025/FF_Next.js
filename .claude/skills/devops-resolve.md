# /devops-resolve — DevOps Ticket Closure Workflow

Close a FibreFlow DevOps (dev_ops) NOC ticket end-to-end after a fix has been deployed.

## When to use

After any code fix that resolves a DevOps ticket (type=`dev_ops`). Claude Code MUST follow this
workflow — do not mark a ticket resolved without completing every step.

---

## Pre-conditions

- Fix is merged to master and deployed to at least dev.fibreflow.app
- You have the ticket UID (e.g. `VF-20260429-037`)

---

## Step 1 — Capture resolution screenshot

Open dev.fibreflow.app in the browser (boss-ghost-mcp) and navigate to the specific feature/page
that was broken. Capture a screenshot proving it works. Save to `/tmp/<TICKET_UID>-resolution.png`.

The screenshot must show the actual working state, not just the app loading.

---

## Step 2 — Attach screenshot to ticket

Upload the screenshot to VF Storage and record it in `maintenance_attachments`:

```sql
INSERT INTO maintenance_attachments
  (ticket_id, file_url, storage_url, filename, file_type, mime_type,
   uploaded_by_name, is_evidence)
VALUES
  ('<ticket_uuid>', '<storage_url>', '<storage_url>',
   '<TICKET_UID>-resolution.png', 'image', 'image/png',
   'Claude Code', true);
```

---

## Step 3 — Progress ticket status

```sql
UPDATE maintenance_tickets
SET status = 'resolved',
    resolved_at = NOW(),
    updated_at = NOW()
WHERE id = '<ticket_uuid>';
```

---

## Step 4 — Update dev_ticket_details

```sql
UPDATE dev_ticket_details
SET agent_status     = 'completed',
    github_pr_url    = 'https://github.com/VelocityFibre/FF_Next.js/pull/<N>',
    github_branch    = '<branch-name>',
    agent_approved_by = '28ab98c1-df21-48f8-a30a-489cd09a0d39',  -- Hein's UUID
    agent_approved_at = NOW(),
    updated_at        = NOW()
WHERE ticket_id = '<ticket_uuid>';
```

---

## Step 5 — Add activity log entries

```sql
INSERT INTO maintenance_activities
  (ticket_id, activity_type, description, created_by_name, created_by_email, source, created_at)
VALUES
  ('<ticket_uuid>', 'status_change',
   'Status changed assigned → in_progress — fix in PR #<N>',
   'Claude Code', 'claude@fibreflow.app', 'system', NOW() - INTERVAL '2 hours'),
  ('<ticket_uuid>', 'status_change',
   'Status changed in_progress → resolved — PR #<N> merged and deployed to dev.fibreflow.app',
   'Claude Code', 'claude@fibreflow.app', 'system', NOW()),
  ('<ticket_uuid>', 'note_added',
   'Resolution: <describe root cause and fix>. Verified on dev.fibreflow.app.',
   'Claude Code', 'claude@fibreflow.app', 'system', NOW());
```

---

## Step 6 — Verify via UI

Open the ticket in dev.fibreflow.app and confirm:
- Status: Resolved
- PR link visible in the DevOps details panel
- Activity log shows the status progression
- Resolution screenshot appears in attachments

---

## DB connection (Velocity server)

```bash
ssh velo@100.96.203.105
PGPASSWORD='ff_x8Km2pQr9vLn' psql -h localhost -p 5437 -U fibreflow_user -d fibreflow
```

Hein's user UUID: `28ab98c1-df21-48f8-a30a-489cd09a0d39`

---

## Schema gotchas

- `maintenance_activities` has NO `created_by` UUID column — use `created_by_name` + `created_by_email`
- `dev_ticket_details.agent_approved_by` is a UUID FK to `users(id)` — never a name string
- `maintenance_tickets` uses `ticket_uid` (not `ticket_number` or `ticket_ref`)

---

## Key rules

- **Never claim resolved without a real screenshot** — code review alone is not verification.
- **Always link the PR** — `dev_ticket_details.github_pr_url` must be set.
- **Three activity entries minimum**: in_progress, resolved, resolution note.
- **Screenshot attachment is mandatory** — saves to `maintenance_attachments` with `is_evidence=true`.
