/**
 * @vitest-environment jsdom
 *
 * The FibreFlow-grant disclosure on the Cortex consent screen.
 *
 * The grant is the widest thing this flow hands out: read-only access to everything the
 * consenting user can see in FibreFlow. The feature's own rule is that the user must be
 * told — an authorisation they did not understand is not an authorisation.
 *
 * Nothing tested that. The notice could have stopped rendering, or rendered when no
 * grant was issued, and every other test in the repo would still have passed. That
 * divergence — grant issued, notice absent — is the one these exist to catch.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CortexMcpConsentCard } from '../CortexMcpConsentCard';
import type { CortexMcpConsentContext } from '@/lib/cortex/mcpConsentContext';

const BASE: CortexMcpConsentContext = {
  clientId: 'claude-client',
  clientName: 'Claude',
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  scopes: ['cortex.read'],
};

function renderCard(context: CortexMcpConsentContext) {
  return render(
    <CortexMcpConsentCard
      phase="ready"
      error={null}
      email="lew@velocityfibre.co.za"
      context={context}
      onAllow={() => {}}
      onCancel={() => {}}
    />,
  );
}

describe('CortexMcpConsentCard — the FibreFlow grant notice', () => {
  it('shows the notice when the grant is being issued', () => {
    renderCard({ ...BASE, ffApiGrant: true });
    expect(screen.getByTestId('ff-api-grant-notice')).toBeTruthy();
  });

  it('does NOT show it when no grant is issued', () => {
    // The mirror. Without it, a notice rendered unconditionally would pass the case
    // above while telling every user they had granted something they had not.
    renderCard({ ...BASE, ffApiGrant: false });
    expect(screen.queryByTestId('ff-api-grant-notice')).toBeNull();
  });

  it('does NOT show it when the field is absent entirely', () => {
    // An older context payload, or a Cortex response that predates the field.
    renderCard(BASE);
    expect(screen.queryByTestId('ff-api-grant-notice')).toBeNull();
  });

  it('tells the user it is read-only and bounded by their own permissions', () => {
    // The wording carries the whole disclosure. "Cortex can read FibreFlow" would be
    // true and still misleading in both directions — it omits that writes are impossible
    // and implies an escalation that does not happen.
    renderCard({ ...BASE, ffApiGrant: true });
    const text = screen.getByTestId('ff-api-grant-notice').textContent ?? '';
    expect(text.toLowerCase()).toContain('read-only');
    expect(text.toLowerCase()).toContain('fibreflow');
    expect(text).toMatch(/already see|you can/i);
  });

  it('still renders the rest of the card either way', () => {
    // Guards the guard: if the card failed to render at all, the two "not shown" cases
    // above would pass for entirely the wrong reason.
    renderCard({ ...BASE, ffApiGrant: false });
    expect(screen.getByText('Claude')).toBeTruthy();
  });
});
