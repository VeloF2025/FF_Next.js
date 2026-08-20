# ONT Box Scanning — Design

**Date:** 2026-08-20
**Status:** Approved for planning
**Module:** `field-stock-pwa` (`/my/stores`)

---

## Problem

The daily handout of ONTs and Gizzu UPSs runs entirely outside FibreFlow.

Evidence from the production database (2026-08-20):

| Fact | Value |
|------|-------|
| `stock_pickings` ever created | 10 — all test records, last one July 2026, 2 stuck at `confirmed` |
| FT-ONT serials `activated` | 25,808 — flipped by the OES sync, **no custody trail** |
| FT-ONT serials `issued` | 1 |
| FT-GIZZU serials | 28,199, all `in_stock` — not one has ever moved through the system |
| Holders with stock held | 2, one of which is "Smoke TestTech" |

The PWA issue flow exists and works, but nobody uses it. The July 2026 audit
(`project_stores_pwa_daily_issue_blocker`) found the flow dead-ended at the final
`process` step with an opaque 422, and that `stock_serials` and `stock_quants`
disagree wildly. Trust was lost and never recovered.

Scanning ONTs one at a time is also simply too slow for a real morning handout.

## The opportunity

Nokia ONT cartons carry a label whose large DataMatrix is titled
**"FULL SERIAL NUMBER LIST IN PACKAGE"**. Decoded from a photo of a real carton
using `zxing-wasm` — the same engine already in the app:

```
DataMatrix #1 (the large square):
ALCLB49486FF;ALCLB4948758;ALCLB4948779;ALCLB49488FC;ALCLB4949054;
ALCLB4949388;ALCLB4949DEF;ALCLB4949F2F;ALCLB4949F3C

DataMatrix #2 ("ISO ALL DATA", ISO/IEC 15434 format 06):
[)>{RS}06{GS}1P3TN01414BA{GS}18VLENOK{GS}2P01{GS}1VOM02{GS}Q9{GS}4LCN{GS}3SM022540C0126A10210{RS}{EOT}

Code128 (below, one per serial, both Base and ISO columns):
ALCLB49486FF … and the (S)-prefixed ISO variants
```

One scan of the large square yields all nine serials. The ISO code independently
carries `Q9` (quantity) and `1P3TN01414BA` (part number), giving us a cross-check
that the read was complete.

This means **no box entity, no receiving pre-step, and no supplier packing-list
integration is required.** The carton tells us what is inside it.

## Target flow

Storeman hands out ten ONTs: **one scan of the box → nine chips appear → scan the
loose tenth → sign.**

Gizzu UPS units have no carton serial list and continue to be scanned one at a
time via the existing dense Code128 path. That path is unchanged by this work.

## Decisions

Taken with Hein, 2026-08-20:

1. **Partial boxes: issue the good ones, flag the rest.** If two of nine serials
   are unknown or registered elsewhere, those two chip red with a plain-English
   reason and are excluded; the other seven are issued. A data problem must never
   block a handout — that is how the flow lost trust the first time. Rejected
   members are logged for back-office follow-up.
2. **Batch size: soft warning above ten.** Scanning past ten in one issue shows a
   confirm dialog; the storeman can proceed. Catches double-scans without
   obstructing a genuine crew kit-out. No hard cap.
3. **Scope: all four flows, issue first.** Issue → Receiving → Stock-take →
   Returns, phased, sharing one parser.
4. **Availability: check both, warn on mismatch.** Issue on the serial evidence,
   but record every serial-versus-`stock_quants` disagreement so the drift is
   visible and can be watched shrinking as Phase 2 receiving comes online.

## Architecture

### Shared core: `src/modules/field-stock-pwa/lib/boxScan.ts`

One pure, dependency-free parser used by every flow. Given a raw decoded barcode
string it returns a discriminated union:

```ts
type ScanPayload =
  | { kind: 'box'; serials: string[] }
  | { kind: 'package-data'; partNumber?: string; quantity?: number; packageId?: string }
  | { kind: 'single'; serial: string }
  | { kind: 'unrecognised'; raw: string };
```

Rules, in order:

- Payload begins with `[)>` → ISO/IEC 15434. Parse the data identifiers on `GS`
  boundaries: `1P` part number, `Q` quantity, `3S` package id. Returns
  `package-data` — it holds no serials.
- Payload splits on `;` into two or more tokens that all match the serial shape
  → `box`. Trim and upper-case each; de-duplicate, preserving order.
- A single token matching the serial shape → `single` (today's behaviour,
  bit-for-bit).
- Anything else → `unrecognised`.

Serial shape is `/^[A-Z0-9]{8,20}$/` after trimming. A leading `S` from the ISO
Code128 column variant (`SALCLB49486FF`) is stripped only when the remainder
matches a known serial prefix, so we never mangle a genuine serial that starts
with S.

**Fail-safe:** an unknown vendor format degrades to `single` or `unrecognised`.
The parser never invents serials from a payload it does not understand.

### Cross-check

When a `box` scan is followed (in either order, within the same scanning session)
by a `package-data` scan of the same carton, compare `quantity` against the number
of serials read. A mismatch surfaces as a warning on the group chip: *"Label says
9, read 7 — rescan the box."* Absence of the ISO scan is not an error; it is an
optional confirmation, because the storeman will normally scan only the large
square.

### `package-data` scanned alone

If the storeman scans the small ISO square by mistake — an easy error, the two
squares sit side by side — he gets a specific message: *"That's the data code.
Scan the large square marked FULL SERIAL NUMBER LIST."* Not a silent failure.

### Grouping in the UI

`PwaScannedSerial` gains two optional fields:

```ts
groupId?: string;      // stable id for all members of one box scan
groupLabel?: string;   // e.g. "Box · 9 serials"
```

`ScanSerialsStep` renders grouped members under a single collapsible
`BoxGroupChip` — "Box · 9 serials · 7 valid, 2 rejected" — expandable to the
per-serial rows, which reuse the existing `SerialChip`. Ungrouped scans render
exactly as they do today. The step counter reads the total valid count across
groups and singles (ten, in the target flow).

Removing a group removes all its members. Removing one member leaves the group
intact with a reduced count.

### Batch validation

New endpoint `POST /api/my/stores/serials/validate-batch`:

```
Request:  { serials: string[], stockItemId: string, sourceLocationId: string }
Response: { results: Array<{ serialNumber, valid, reason?, currentLocationName? }>,
            quantsWarning?: { expected: number, quantsOnHand: number } }
```

One round-trip for nine serials instead of nine. Input is capped (50 serials) and
each serial is shape-validated before it reaches SQL. Reuses the same status and
location logic as the existing single-serial route so the two cannot drift apart —
the single route is refactored to call the shared checker, not duplicated.

The `quantsWarning` field carries decision 4: the endpoint compares the serial
evidence against `stock_quants` for the item at that location and reports the
disagreement without blocking.

### Availability at `process` time

`pages/api/my/stores/pickings/[pickingId]/_availability.ts` currently requires a
`stock_quants` row for the item at the source warehouse. For **serial-tracked
items only**, availability becomes: every scanned serial exists, is `in_stock`,
and sits at the source location. The quants comparison still runs, and a
disagreement is written to a drift log rather than raising a 422. Bulk,
non-serial-tracked items keep the quants check unchanged.

### Photo fallback

`pages/api/my/stores/serials/_extractCore.ts` returns a single serial today. It is
extended to return a list when the decoded payload parses as a `box`, sharing the
same `boxScan.ts` parser. The response gains `serials: string[]` alongside the
existing `serial` field, which is retained for the single-serial callers.

## Phases

**Phase 1 — Issue.** `boxScan.ts`, `validate-batch`, group chips in
`ScanSerialsStep`/`useScanSerial`, soft warning above ten, serial-first
availability with drift logging, multi-serial photo fallback. Ships alone and
delivers the daily handout.

**Phase 2 — Receiving** (`/my/stores/receive`, new flow). A pallet arrives; the
storeman picks the warehouse and scans each carton. Its serials are registered or
relocated to that warehouse as `in_stock`, with a movement row recorded, and
optionally linked to a GRN. **This is the structural fix for the drift**: serial
locations presently come from the FT SharePoint sync and physical redistribution
is never recorded, which is precisely why a Lawley-registered serial was refused
at Garstfontein in July.

**Phase 3 — Stock-take** (`/my/stores/count`, new flow). Scan sealed cartons on a
shelf and diff against expected on-hand. Turns a carton-opening count into one
scan per box.

**Phase 4 — Returns.** The same parser in `ReturnOrchestrator` and
`InspectOrchestrator`, for the case where a technician hands back a sealed box.
Lowest value of the four — returns are usually loose units.

Each phase is a separate PR with its own blind review.

## Error handling

| Situation | Behaviour |
|-----------|-----------|
| Serial in box unknown to the system | Chip red, "Not in stock system", excluded, logged |
| Serial registered at another warehouse | Chip red with the location name, excluded, logged |
| Serial already issued or activated | Chip red with the status, excluded, logged |
| Box read is short of the label quantity | Group warning, prompt to rescan; valid members still usable |
| Small ISO square scanned instead | Named message directing to the large square |
| Duplicate box scan | Silent de-dup with haptic, as today |
| Serial appears both loose and in a box | Counted once; the group keeps it, the loose chip is dropped |
| All nine members invalid | Group chip red, submit stays disabled — nothing to issue |
| Camera cannot decode the dense square | Photo fallback returns the full list |

## Testing

- **Unit** (`boxScan.test.ts`): the real decoded payloads from this document as
  fixtures — the nine-serial box string, the ISO 15434 string, the `S`-prefixed
  variant, a single serial, malformed and empty input, a payload with one valid
  and one malformed token, and a >50-serial payload.
- **Unit** (`validate-batch`): mixed valid/invalid results, wrong-location
  rejection, cap enforcement, quants-mismatch warning, SQL parameterisation.
- **Unit** (hook/UI): group expansion, member removal, group removal, count
  arithmetic across groups and singles, the soft warning firing above ten and
  being dismissible.
- **Decode regression**: the carton photograph committed as a test fixture, decoded
  through `zxing-wasm` in CI, asserting all nine serials — this guards the parser
  against a future engine or config change.
- **Device test, week one**: a real mid-range Android against a real carton under
  warehouse lighting. The desk decode succeeded on a WhatsApp-compressed photo,
  which is encouraging but is not the same test.

## Risks

1. **Live-video decode density.** The box DataMatrix is far denser than a single
   serial barcode. Mitigated by the existing hi-res video constraints, native
   `BarcodeDetector`, and the photo fallback — but it must be proven on a real
   device early, not assumed.
2. **Vendor format drift.** The parser is written against Nokia's format. Another
   ONT vendor or a new Nokia label revision may delimit differently. Mitigated by
   fail-safe degradation and by keeping the format rules in one file.
3. **Drift surfaces loudly on day one.** Serial-first availability will expose how
   wrong `stock_quants` is. That is the point, but expect noise in the drift log
   until Phase 2 lands.
4. **Adoption, not code.** The build was never the gap. Phase 1 must be walked
   through with the storemen on a real morning handout, or this repeats 2026-07.

## Out of scope

- Any change to the Gizzu scanning path.
- Bulk, non-serial-tracked material availability.
- Reconciling the historical `stock_quants` opening balance (26 May 2026 Odoo
  load, ~7x overstated) — see `project_stock_inventory_state`.
- The stuck pickings PCK-000009/10 recovery path.
- Purging test technicians from the production picker.

Items three through five are real and known; they are separate work.
