# Accessible Component Library

> **Last updated:** 2026-02-21  
> **Location:** `src/components/accessible/`  
> **Standard:** WCAG 2.1 AA

## Overview

Reusable WCAG-compliant components for common UI patterns. Prefer these over rolling custom implementations — they handle aria attributes, keyboard navigation, and focus management correctly.

```typescript
import { ProgressBar, AccessibleAccordion, AccessibleCheckbox } from '@/components/accessible';
```

## ProgressBar

**WCAG:** 1.3.1 (Info and Relationships), 4.1.2 (Name, Role, Value)

```tsx
<ProgressBar
  value={75}
  max={100}
  label="Upload progress"
  thresholds={{ warning: 60, danger: 80 }}  // optional colour thresholds
/>
```

- Renders `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- `thresholds` prop changes colour: green → amber → red
- `label` becomes the accessible name

## AccessibleAccordion

**WCAG:** 4.1.2 (Name, Role, Value)

```tsx
<AccessibleAccordion
  items={[
    { id: 'section-1', title: 'Section One', content: <p>Content here</p> },
    { id: 'section-2', title: 'Section Two', content: <p>More content</p> },
  ]}
  defaultOpen="section-1"   // optional
/>
```

- `aria-expanded` + `aria-controls` wired automatically
- Keyboard navigable (Enter/Space to toggle, Tab between headers)
- Each panel has matching `id` for aria-controls linkage

## AccessibleCheckbox

**WCAG:** 1.3.1, 2.4.7 (Focus Visible), 4.1.2

```tsx
<AccessibleCheckbox
  id="agree-terms"
  label="I agree to the terms"
  checked={agreed}
  onChange={setAgreed}
  error="You must agree to continue"   // optional — shown + aria-invalid
  description="Read our terms of service"  // optional hint text
/>
```

- Visible focus ring (peer pattern)
- `aria-invalid` set when `error` prop provided
- `aria-describedby` wired to both `error` and `description` elements

## When to Use

| Situation | Component |
|-----------|-----------|
| Upload/task/completion progress | `ProgressBar` |
| FAQ, expandable detail sections | `AccessibleAccordion` |
| Form checkboxes with validation | `AccessibleCheckbox` |
| Native `<input type="checkbox">` in forms | `AccessibleCheckbox` |

## When NOT to Use

- `ProgressBar` — don't use for decorative bars with no meaningful value (use a plain `div` with `aria-hidden`)
- `AccessibleAccordion` — not a replacement for tabs; use for show/hide content patterns only

## Related

- `knowledge-base/ui-patterns/common-ui-issues.md` — general WCAG pitfalls
- WCAG 2.1 AA compliance is enforced across all new UI — run Axe or Lighthouse to verify
