# PBI Visuals Reference — FibreFlow Analytics

> Source of truth for Power BI–style visual standards in FibreFlow.
> Reference this file when implementing analytics dashboards, report tables, and KPI cards.

## Colour Palette

| Token | Hex | Usage |
|-------|-----|-------|
| PBI Primary | `#118DFF` | Primary accent, column headers, active tabs, chart series 1 |
| PBI Positive | `#107C10` | Positive values, GP% > 15%, cash in totals |
| PBI Negative | `#D13438` | Negative values, GP% < 0%, cash out, deficits |
| PBI Surface | `#252423` | Dark background for card/panel surfaces |
| PBI Amber | `#F2C811` | Warning, GP% 0–15% |

> **Planned:** Colour tokens will live in `src/modules/analytics/pbi/pbiTheme.ts` (not yet implemented).

## KPI Cards

### Structure
Each report page must open with a row of KPI headline cards above the table.

```tsx
// Planned component — not yet implemented
// import { KpiCard } from '@/modules/analytics/pbi/KpiCard';

<div className="grid grid-cols-3 gap-4 mb-6">
  <KpiCard label="Net Position" value={netPosition} trend="positive" />
  <KpiCard label="Total Cash In" value={cashIn} />
  <KpiCard label="Total Cash Out" value={cashOut} trend="negative" />
</div>
```

### Props
- `label`: string — display name
- `value`: number — raw value (formatted internally)
- `trend?: "positive" | "negative" | "neutral"` — arrow direction + colour

### KPI Cards by Report

| Report | KPI Cards |
|--------|-----------|
| Cashflow | Total Cash In \| Total Cash Out \| Net Position |
| Project Revenue | Projects \| FC Activations |
| Expense Pivot | Grand Total \| Categories \| Months |
| Project Finance | Total Revenue \| Total COS \| Gross Profit \| GP% |
| Project Detail | Activations \| Revenue \| Gross Profit \| Net \| COS Total |

## Table Styling

### Currency Formatting
- Format: `R 1,234,567` (no decimals for ZAR amounts)
- Zero values: display as `—` (em dash, not "0" or "R 0")
- Negative: prefix with `−` and apply `#D13438` colour
- Positive: apply `#107C10` colour (optional — don't over-colour)

### Conditional Formatting Rules

| Column | Condition | Colour |
|--------|-----------|--------|
| GP% | > 15% | `#107C10` (green) |
| GP% | 0% – 15% | `#F2C811` (amber) |
| GP% | < 0% | `#D13438` (red) |
| Any negative value | < 0 | `#D13438` (red) |
| Net/balance | positive | `#107C10` (green) |

### Header Style
- Dark teal background matching FibreFlow theme (use `--ff-bg-tertiary` or equivalent CSS var)
- White text, `font-semibold`
- No hardcoded Tailwind colour classes — use CSS variables

### Row Styling
- Alternating row shading: subtle, use `--ff-bg-secondary`
- Total/summary rows: bold, slightly darker background
- Hover: `--ff-bg-hover`

## Chart Types by Report

| Report | Chart Type |
|--------|-----------|
| Cashflow | Waterfall chart (cash in = positive bars, cash out = negative) |
| Project Revenue | Clustered bar (revenue vs target) |
| Expense Pivot | Stacked bar by category × month |
| Project Finance | Clustered bar (Revenue / COS / GP) |
| Project Detail | Stacked bar per project |

## Accessibility

All tables must comply with WCAG 2.1 AA:
- `<caption className="sr-only">` describing the table contents
- `<th scope="col">` on all column headers
- `role="tablist"` + `role="tab"` + `aria-selected` on tab components
- `aria-controls` linking tabs to content panels
- Keyboard nav: ArrowLeft/Right, Home, End on tablist
- Colour must not be the **only** indicator — pair with icon or label

## File Locations

```
src/modules/analytics/
├── pbi/                               # PLANNED — not yet created
│   ├── pbiTheme.ts                    # Planned: colour tokens + shared formatters
│   └── KpiCard.tsx                    # Planned: reusable KPI headline card
├── reports/
│   └── tables/
│       ├── CashflowTable.tsx          ✅ exists
│       ├── ProjectRevenueTable.tsx    ✅ exists
│       ├── ExpensePivotTable.tsx      ✅ exists
│       ├── ProjectFinTable.tsx        ✅ exists
│       └── ProjectDetailTable.tsx     ✅ exists
```

## Usage Notes

- When `pbiTheme.ts` is implemented: import colour tokens from there — never hardcode hex values inline
- Planned: `formatCurrency(value)` helper will handle R format + zero display
- Planned: `getGPColor(percent)` helper will return the correct conditional colour for GP%
- All chart series colours should come from the PBI palette above (series 1 = `#118DFF`, series 2 = `#107C10`, series 3 = `#D13438`, etc.)

---
*Created: 2026-03-21 | Owner: Elon (CTO) | Maintained by: Flow + Pixel*
