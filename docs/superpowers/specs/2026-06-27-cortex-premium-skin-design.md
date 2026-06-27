# Premium "Cortex landing" skin for FibreFlow `/cortex`

**Date:** 2026-06-27
**Branch:** `feat/cortex-premium-skin`
**Goal:** Make the in-app `/cortex` page feel as exclusive/expensive as the Cortex
landing page (`velocity.cortexhq.xyz`), while keeping it a navigable FibreFlow
tool inside the existing app shell (sidebar + topbar stay).

## Decision (approved)

Option B — **hero + premium re-skin, app shell stays**. Not a full-bleed takeover.

## Source of truth for the aesthetic

`Cortex/apps/space-agent/public/landing.css`. Brand tokens ported verbatim:

| Role            | Value |
|-----------------|-------|
| Base (near-black) | `#070909` → `#0b0d0d` |
| Primary text (ivory) | `#f3efe6` |
| Muted text | `#c9c1b3` |
| Label/stone | `#918a7c` |
| Gold accent (champagne) | `#c6a15b`; light `#e0c482` |
| Approve (emerald) | `#4fbf8f` |
| Reject (vermilion) | `#d65a45` |
| Glass | `rgba(255,255,255,.055)` bg, `1px rgba(255,255,255,.14)` border, `blur(18px)`, `0 24px 80px rgba(0,0,0,.32)` shadow |
| Radius | 8px · Font: Inter |

## Architecture

The three Cortex components (`CortexConnectPanel`, `CortexCitedSearch`,
`CortexReviewPanel`) use shadcn semantic tokens (`bg-card`, `text-foreground`,
`bg-primary`, `text-destructive`…) mapped via `hsl(var(--token))`. We exploit that:

1. **Scoped token override (no markup churn).** A new global stylesheet
   `styles/cortex-premium.css` (imported once in `pages/_app.tsx`, after
   `globals.css`) defines a `.cortex-premium` wrapper that **redefines the shadcn
   HSL-channel tokens** (`--card`, `--foreground`, `--primary`, `--destructive`,
   `--border`, `--ring`, `--background`…) to the premium palette **for that subtree
   only**. Because custom properties resolve from the nearest ancestor, the page
   renders gold-on-black **regardless of FibreFlow's light/dark mode** (forced-dark,
   scoped — the rest of the app is untouched).
2. **Helper classes for effects a flat token can't express:** `.cx-glass`
   (translucent + blur + shadow), `.cx-eyebrow` (uppercase gold label),
   `.cx-btn-gold` (gradient gold CTA), `.cx-btn-emerald` (approve), plus hero/stat
   classes. Added to the existing markup with minimal edits.

All selectors are scoped under `.cortex-premium` → zero leakage into other routes.
The three components are imported **only** by `pages/cortex.tsx` (verified), so the
small markup edits affect nothing else.

## File-by-file plan

- `public/cortex-brand/cortex-aperture-c-hero-trimmed.png` (+ `cortex-mark-primary.svg`) — copied from Cortex. Under `cortex-brand/` to avoid any ambiguity with the `/cortex` route.
- `styles/cortex-premium.css` — **new.** Scoped tokens + helper classes (~180 lines).
- `pages/_app.tsx` — **+1 line:** import the stylesheet after `globals.css`.
- `src/components/cortex/CortexHero.tsx` — **new.** Gold eyebrow → aperture-`C` wordmark → tagline → 3 glass stat cards (TENANT MODEL / SOURCES / CONTROL). CONTROL shows the **live pending-review count** via its own lightweight `GET /api/cortex-review` (decoupled from the review panel's fetch; cheap list).
- `pages/cortex.tsx` — wrap content in `.cortex-premium` (full-height premium surface + centered max-w container), render `<CortexHero/>` in place of the old `<h1>`/subtitle.
- `CortexConnectPanel.tsx` — outer div → `cx-glass`; add `cx-eyebrow` "MCP ACCESS"; Generate button → `cx-btn-gold`.
- `CortexCitedSearch.tsx` — outer div → `cx-glass`; add `cx-eyebrow` "GROUNDED RETRIEVAL"; Search button → `cx-btn-gold`. (`[n]` badge & left accent become champagne via the `--primary` override.)
- `CortexReviewPanel.tsx` — item cards → `cx-glass`; Approve → `cx-btn-emerald`; Reject stays `border-destructive`/`text-destructive` (now vermilion via override).

## Out of scope (YAGNI)

No full-bleed takeover; no marketing sections; no other route touched; no global
theme change; no new dependencies.

## Verification

`npm run ci:quick` (lint + types + unit tests — existing `CortexConnectPanel`
tests must stay green; they assert button roles/labels only, which are unchanged)
→ **real-browser render check of `/cortex`** (per the UI-needs-browser-verification
rule) → PR off `feat/cortex-premium-skin`. No edits in deploy dirs; no direct commit
to `master`.
