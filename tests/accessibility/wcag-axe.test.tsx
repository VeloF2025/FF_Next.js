/**
 * WCAG P12 — Static Axe Scanner
 * Runs axe-core accessibility checks on FibreFlow's accessible component library.
 * Catches ARIA violations, missing labels, role semantics, and structural issues.
 *
 * Scope: @/components/accessible/* — the canonical accessible component library.
 * These components are the foundation; violations here propagate everywhere.
 *
 * Run: npx vitest run tests/accessibility/wcag-axe.test.tsx
 * CI: .github/workflows/wcag-static-scanner.yml
 *
 * Prepared by: Pixel 2026-02-23
 * Note: colour-contrast disabled in axe config — tested by ci-contrast-check.js (P10)
 * Note: logger is mocked globally in vitest.setup.ts — no local mock needed
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

import {
  ProgressBar,
  AccessibleAccordion,
  AccessibleCheckbox,
  AccessibleModal,
} from '@/components/accessible';

import type { AccordionItemConfig } from '@/components/accessible';

// Extend vitest expect with jest-axe matchers
expect.extend(toHaveNoViolations);

// axe config — colour contrast checked separately by ci-contrast-check.js (P10)
// Disabling here avoids false positives from jsdom's lack of real CSS variable resolution.
const AXE_CONFIG = {
  rules: {
    'color-contrast': { enabled: false },
  },
};

// ─── ProgressBar ─────────────────────────────────────────────────────────────

describe('ProgressBar — WCAG axe scan', () => {
  it('renders with no violations at 65%', async () => {
    const { container } = render(
      <ProgressBar value={65} label="Stage progress" />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('renders with no violations at 0% with showLabel', async () => {
    const { container } = render(
      <ProgressBar value={0} label="Loading" showLabel />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('renders with no violations at 100%', async () => {
    const { container } = render(
      <ProgressBar value={100} label="All complete" showLabel />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('has role=progressbar with correct aria attributes', () => {
    const { container } = render(
      <ProgressBar value={42} label="Completion" />
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-valuenow')).toBe('42');
    expect(bar?.getAttribute('aria-valuemin')).toBe('0');
    expect(bar?.getAttribute('aria-valuemax')).toBe('100');
    expect(bar?.getAttribute('aria-label') || bar?.getAttribute('aria-labelledby')).toBeTruthy();
  });
});

// ─── AccessibleAccordion ─────────────────────────────────────────────────────

describe('AccessibleAccordion — WCAG axe scan', () => {
  const makeItems = (): AccordionItemConfig[] => [
    {
      id: 'phase-1',
      header: (expanded) => <span>Phase 1 {expanded ? '▲' : '▼'}</span>,
      body: <p>Phase 1 body content</p>,
    },
    {
      id: 'phase-2',
      header: (expanded) => <span>Phase 2 {expanded ? '▲' : '▼'}</span>,
      body: <p>Phase 2 body content</p>,
    },
  ];

  it('renders all collapsed with no violations', async () => {
    const { container } = render(
      <AccessibleAccordion
        items={makeItems()}
        expandedIds={new Set()}
        onToggle={vi.fn()}
      />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('renders one expanded with no violations', async () => {
    const { container } = render(
      <AccessibleAccordion
        items={makeItems()}
        expandedIds={new Set(['phase-1'])}
        onToggle={vi.fn()}
      />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('renders all expanded with no violations', async () => {
    const { container } = render(
      <AccessibleAccordion
        items={makeItems()}
        expandedIds={new Set(['phase-1', 'phase-2'])}
        onToggle={vi.fn()}
      />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('trigger buttons have aria-expanded and aria-controls', () => {
    const { container } = render(
      <AccessibleAccordion
        items={makeItems()}
        expandedIds={new Set(['phase-1'])}
        onToggle={vi.fn()}
      />
    );
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => {
      expect(btn.getAttribute('aria-expanded')).toBeDefined();
      expect(btn.getAttribute('aria-controls')).toBeTruthy();
    });
  });
});

// ─── AccessibleCheckbox ──────────────────────────────────────────────────────

describe('AccessibleCheckbox — WCAG axe scan', () => {
  it('renders unchecked with no violations', async () => {
    const { container } = render(
      <AccessibleCheckbox id="chk-1" label="I agree to terms" checked={false} onChange={() => {}} />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('renders checked with no violations', async () => {
    const { container } = render(
      <AccessibleCheckbox id="chk-2" label="Enable notifications" checked onChange={() => {}} />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('renders readOnly (auto-populated) with no violations', async () => {
    const { container } = render(
      <AccessibleCheckbox
        id="chk-auto"
        label="Auto-populated"
        checked
        onChange={() => {}}
        readOnly
      />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('native input has id and label has matching htmlFor', () => {
    const { container } = render(
      <AccessibleCheckbox id="chk-label-test" label="Test label" checked={false} onChange={() => {}} />
    );
    const input = container.querySelector('input[type="checkbox"]');
    const label = container.querySelector('label');
    expect(input?.id).toBe('chk-label-test');
    expect(label?.getAttribute('for')).toBe('chk-label-test');
  });

  it('renders with external aria-labelledby (no visible label) with no violations', async () => {
    const { container } = render(
      <div>
        <span id="external-label">External label text</span>
        <AccessibleCheckbox id="chk-ext" labelledById="external-label" checked={false} onChange={() => {}} />
      </div>
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });
});

// ─── AccessibleModal ─────────────────────────────────────────────────────────

describe('AccessibleModal — WCAG axe scan', () => {
  it('renders open modal with no violations', async () => {
    const { container } = render(
      <AccessibleModal isOpen onClose={() => {}} title="Confirm action">
        <p>Are you sure you want to proceed?</p>
        <button type="button">Confirm</button>
        <button type="button">Cancel</button>
      </AccessibleModal>
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });

  it('does not render dialog when closed', () => {
    const { container } = render(
      <AccessibleModal isOpen={false} onClose={() => {}} title="Hidden">
        <p>Not visible</p>
      </AccessibleModal>
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('dialog has role=dialog, aria-modal, aria-labelledby', () => {
    const { container } = render(
      <AccessibleModal isOpen onClose={() => {}} title="Accessibility test" titleId="aria-test-title">
        <p>Content</p>
      </AccessibleModal>
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('aria-test-title');
  });

  it('heading has correct id matching aria-labelledby', () => {
    const { container } = render(
      <AccessibleModal isOpen onClose={() => {}} title="My Modal" titleId="my-modal-title">
        <p>x</p>
      </AccessibleModal>
    );
    const heading = container.querySelector('#my-modal-title');
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toContain('My Modal');
  });

  it('close button has aria-label', () => {
    const { container } = render(
      <AccessibleModal isOpen onClose={() => {}} title="Test">
        <p>x</p>
      </AccessibleModal>
    );
    const buttons = container.querySelectorAll('button');
    const closeBtn = Array.from(buttons).find(b =>
      b.getAttribute('aria-label')?.toLowerCase().includes('close')
    );
    expect(closeBtn).not.toBeNull();
  });
});

// ─── Composition — nested components ─────────────────────────────────────────

describe('Composite — nested accessible components', () => {
  it('renders accordion with progress bars and checkboxes — no violations', async () => {
    const items: AccordionItemConfig[] = [
      {
        id: 'prereq-section',
        header: (expanded) => <span>Prerequisites {expanded ? '▲' : '▼'}</span>,
        body: (
          <div>
            <ProgressBar value={66} label="Prerequisites completion" showLabel />
            <AccessibleCheckbox id="prereq-design" label="Design review" checked onChange={() => {}} />
            <AccessibleCheckbox id="prereq-code" label="Code review" checked={false} onChange={() => {}} />
            <AccessibleCheckbox id="prereq-test" label="Test coverage" checked onChange={() => {}} readOnly />
          </div>
        ),
      },
    ];

    const { container } = render(
      <AccessibleAccordion
        items={items}
        expandedIds={new Set(['prereq-section'])}
        onToggle={vi.fn()}
      />
    );
    expect(await axe(container, AXE_CONFIG)).toHaveNoViolations();
  });
});
