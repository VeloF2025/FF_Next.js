# Procurement End-to-End Audit — 2026-06-10

Scope: supplier ordering → receiving → hand-out → on-site consumption, plus tools/equipment book-out and asset lifecycle. Method: code map vs origin/master, live DB inspection (shared Supabase), API smoke tests + headless Playwright page checks against dev.fibreflow.app (authenticated super_admin session).

## Verdict by stage

| Stage | Code | Live behaviour | In use? |
|---|---|---|---|
| BOQ → RFQ → Quote | WIRED (boq_rfq_links, create-rfq, convert-to-po) | Pages + APIs 200 | Barely (10 BOQs, 2 RFQs, 0 quotes) |
| Requisition → PO | WIRED (submit → approval → convert-to-po; <R10k auto-approve) | 200 | YES — 155 reqs, 28/30d |
| PO lifecycle | WIRED (approvals, Odoo import, docs panel: Quote/PO/GRV/Invoice) | 200 | YES — 513 POs, 33/30d |
| GRN receiving → stock | WIRED (`grn-confirm` updates stock_items + stock_movements; DB trigger `tr_grn_stock_update` intentionally disabled) | 200 | **STOPPED 2026-02-19** — last GRN and last stock_movement both 2026-02-19; all 341 movements are `source_type='odoo'`; the Odoo sync has no cron and is dead; zero native FibreFlow GRN-confirm movements ever |
| Warehouse → field hand-out (pickings) | WIRED (transactional process: quants, serials → issued, movements) | 200 | DORMANT — 5 pickings ever, 1 in 30d |
| Consumption on site | WIRED (scan-serial → stock_consumptions + serial → installed; requires status='issued') | 200 (empty) | **NEVER USED** — 0 consumptions, 0 returns, 0 ONT scans in qa_photo_reviews. Serials are `in_stock` (27,752) or `activated` (18,621, via OES bypass); only 34 ever `installed`, 0 `issued` — so the scan flow would reject nearly every serial anyway |
| Daily reconciliation / accountability | WIRED (Issued − Installed − Returned; block at >3 items or >R5k) | 200 | No data to reconcile |
| Tools/equipment book-out | **BROKEN** — UI calls /api/stock/serials, checkout, checkin, serial-history; all need `stock_item_serials` which was never migrated to the shared DB; live `tool_checkouts` has the old 231 shape (no serial_id/project_id) | 500 (proven live) | Never worked — tool_checkouts 0 rows. **FIXED in PR #1917 (mig 405)** |
| Asset management (register → checkout → checkin → maintenance/calibration → disposal) | WIRED end-to-end (App Router /assets, status machine, transfer, overdue query) | All pages + APIs 200 | YES — 229 assets, 94 assignments (last 2026-04-22) |

## Live 500s found and fixed (PR #1917)

1. **Tool book-out dead** — missing `stock_item_serials` table + missing `tool_checkouts.serial_id/project_id`. Mig 405 creates/aligns; rollback included.
2. **GET /api/procurement/cost-centers → 500** — `query.replace('SELECT *', …)` never matched (TODO comment between SELECT and `*`); `countResult[0]!.count` threw on the empty view. Proven: `?include_tree=true` path 200, list path 500.
3. **GET /api/procurement/budget/dashboard → 500** — selects `bt.reference_id`; live `budget_transactions` has `source_id`/`source_number`. Reproduced against live DB; aliased.

## UI verification (headless, dev)

17 pages: all render 200, no console errors, no failed API calls — /procurement (dashboard, purchasing, grn, requisitions, approvals, inventory, field-stock, stock-items, quotes, rfq, boq), /suppliers, /assets (+list/checkout/checkin), /stock/portal. `/procurement/boq` and `/assets` need ~5s cold compile (first hit timed out at 30s, fine on retry).

## Findings NOT fixed (decisions needed)

1. **Receiving is unrecorded since 2026-02-19.** POs keep being created (33/30d) but no GRNs and no stock movements since Feb 19. The Odoo picking sync has no cron and is dead; the native GRN flow is unused. Stock on hand in FibreFlow is ~4 months stale (aligns with the 7× overstated quants finding from the stock-take recon). Decide: revive GRN capture (storeman "Receive Delivery" flow exists in /stock/portal) or accept FibreFlow as non-authoritative for stock.
2. **Hand-out → consumption chain is built but not operated.** Field teams don't get stock issued via pickings, and installs don't decrement anything; OES activation jumps serials in_stock → activated, bypassing issued/installed. The 12-step QA serial scan (steps 8/9) requires status='issued' and would reject nearly all serials — process adoption issue, not code.
3. **Supplier-facing RFQ loop is internal-only.** RFQ emails go to a hardcoded internal list ("until supplier emails are wired"); SupplierPortalPage component exists but is not mounted at any route; 0 quotes in DB. Quote capture is via PDF extraction by staff.
4. **Asset APIs have no RBAC enforcement** — `requireAuth` only; any authenticated user can checkout/checkin any asset (page-level permissions exist: assets.checkout etc., API-level absent).
5. **Two parallel tool-checkout API families**: /api/stock/* (serial-based, UI-wired, fixed by mig 405) and /api/stock-items/* (tool_checkouts-only, not called by current UI). Candidates for consolidation.
6. **Same `/* TODO: specify columns */` pattern** remains in cost-centers/[id].ts and budget/templates (both return 200 or 200-empty today; no crash path proven).
7. **Old ECONNREFUSED 127.0.0.1:5437** entries in dev error log from cron routes during a past DB restart window — transient, port reachable now.

## Evidence

- DB counts (2026-06-10): purchase_orders 513, GRNs 325, requisitions 155, rfqs 2, quotes 0, suppliers 21, assets 229, asset_assignments 94, tool_checkouts 0, stock_pickings 5, stock_consumptions 0, stock_returns 0, stock_serials 46,407 (in_stock 27,752 / activated 18,621 / installed 34), stock_quants 495.
- POST /api/stock/checkout (valid payload, manager role) → 500; GET /api/stock/serials?stockItemId=<tool> → 500.
- `\d tool_checkouts` pre-migration captured in PR #1917 description.
