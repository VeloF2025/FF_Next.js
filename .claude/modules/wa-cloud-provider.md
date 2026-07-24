# WhatsApp Cloud Provider — Send-Path Inventory

Full reference for `src/modules/communications/whatsapp/`. Quick pointer lives in
`src/modules/communications/.claude.md`.

## Background

WhatsApp Cloud API (Meta Graph) is **1:1 ONLY** — it cannot send to WhatsApp groups.
The legacy Go bridge (VPS `72.61.197.178:8083`) remains the only sender for group
messages, forever. `wa_provider` (`wa_service_config`) selects `cloud` vs `bridge`/`waha`
for 1:1 sends only; group sends always go straight to the bridge regardless of
`wa_provider`.

`sendWhatsAppText({toPhone, message, channel?})` in
`src/modules/communications/whatsapp/send/waSendClient.ts` is the **provider-aware 1:1
sender** — it reads `wa_provider` (or an explicit `channel` override) and dispatches to
either `sendViaCloud` (Graph API) or `sendWhatsAppDM` (WAHA). It **returns**
`{ok: false, ...}` on failure — it never throws.

`sendWhatsAppDM(phone, message): Promise<void>` in
`src/modules/notifications/services/whatsappDelivery.ts` is the **raw WAHA-only** 1:1
sender — hardcoded to the bridge's WAHA endpoint, no provider awareness. It **throws** on
HTTP failure.

⚠️ **These have opposite failure contracts.** Swapping a `sendWhatsAppDM` call site for
`sendWhatsAppText` without adding a `.ok` check turns a loud failure (unhandled
rejection / caught throw) into a silent drop (successful-looking resolve with
`ok: false` ignored).

## Send-path inventory (Phase 3, task 1 — 2026-07-25)

Every production caller of a bridge/whatsappDelivery/waSendClient sender, classified
DM (1:1, eligible to move onto the provider-aware path) or GROUP (must stay on the
bridge forever, since Cloud can't do groups).

| # | Call site | Sender used | Type | Target | Notes |
|---|-----------|-------------|------|--------|-------|
| 1 | `app/api/noc/tickets/[id]/whatsapp/reply/route.ts:35` | `sendWhatsAppText` | **DM** | NOC ticket reply to customer | Already provider-aware (Phase 1) — no change needed |
| 2 | `pages/api/my/sitecam/appeal.ts:88` | `sendWhatsAppGroup` | GROUP | `SITECAM_APPEAL_GROUP_JID` | Fire-and-forget, non-fatal |
| 3 | `src/lib/group-nonactivation/delivery.ts:95` (`sendGroupReport`) | `sendWhatsAppGroupDocument` | GROUP | per-project group | xlsx report |
| 4 | `src/lib/group-nonactivation/delivery.ts:113` (`sendOpsReport`) | `sendWhatsAppGroupDocument` | GROUP | `OPS_REVIEW_GROUP_JID` | xlsx report |
| 5 | `scripts/cron/attendance-cartrack-reconcile.ts:148` | `sendWhatsAppGroup` (injected into `sendCartrackReconcileAlert`) | GROUP | attendance-ops WA group | `cartrackWaAlert.ts` itself takes `send` as a DI param — no direct import |
| 6 | `src/modules/noc/services/snagGroupNotifications.ts:280` | `sendWhatsAppGroupImage` | GROUP | snags project group | ticket-created, with before-photo |
| 7 | `src/modules/noc/services/snagGroupNotifications.ts:292` | `sendWhatsAppGroup` | GROUP | snags project group | ticket-created, text fallback |
| 8 | `src/modules/noc/services/snagGroupNotifications.ts:337,339` | `sendWhatsAppGroupImage` | GROUP | snags project group | resolution, after-photos |
| 9 | `src/modules/noc/services/snagGroupNotifications.ts:359` | `sendWhatsAppGroupImage` | GROUP | snags project group | non-resolution status, before-photo |
| 10 | `src/modules/noc/services/snagGroupNotifications.ts:371` | `sendWhatsAppGroup` | GROUP | snags project group | status update, text fallback |
| 11 | `src/modules/notifications/services/whatsappDelivery.ts:36` (`deliverWhatsApp`, group branch) | `sendWhatsAppGroup` | GROUP | `payload.wa_group_jid` | stays — Cloud can't do groups |
| 12 | `src/modules/notifications/services/whatsappDelivery.ts:52` (`deliverWhatsApp`, DM branch) | `sendWhatsAppDM` | **DM** | individual user (staff/users phone lookup) | **only DM call site still hardcoded to WAHA — Phase 3 task 5 target** |
| 13 | `src/services/oesNightlyReport.ts:131` | `sendWhatsAppGroupDocument` | GROUP | `OES_ACTIVATIONS_GROUP_JID` | v2 path |
| 14 | `src/services/oesNightlyReport.ts:212` | `sendWhatsAppGroupDocument` | GROUP | `OES_ACTIVATIONS_GROUP_JID` | legacy path |

**Net scope for the "DM-only bridge reroute" task:** exactly one call site —
`whatsappDelivery.ts:52` inside `deliverWhatsApp`'s DM branch. Everything else is
already either provider-aware (#1) or permanently GROUP (#2–11, #13–14).

Rerouting #12 must:
- Call `sendWhatsAppText({toPhone: phone, message})` instead of `sendWhatsAppDM(phone, message)`.
- Explicitly check `result.ok` and treat `ok: false` as a failure — `deliverWhatsApp`'s
  existing outer `try/catch` only catches *throws*; `sendWhatsAppText` never throws, so
  without an explicit check a failed send would fall through to the "sent" log line.
- Preserve the existing `logDelivery(..., 'failed', ...)` + `log.error` behavior on
  failure, so a silent-drop regression is impossible.

No send-path code changes were made in this commit (read-only inventory only).
