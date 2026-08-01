/**
 * @vitest-environment jsdom
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CortexConnectionPanel } from '../CortexConnectionPanel';
import {
  renderWithNetwork,
  resetNetwork,
} from './connections-network';

afterEach(() => {
  resetNetwork();
});

describe('CortexConnectionPanel', () => {
  it('shows browser consent and no token or local runtime setup', () => {
    render(<CortexConnectionPanel />);

    expect(screen.getByText('Cortex Knowledge')).toBeInTheDocument();
    expect(screen.getByText(
      'https://app.fibreflow.app/api/cortex-remote-mcp/mcp',
    )).toBeInTheDocument();
    expect(screen.getByText(/FibreFlow sign-in and consent/i))
      .toBeInTheDocument();
    expect(screen.queryByLabelText(/Cortex MCP token/i)).toBeNull();
    expect(screen.queryByText(/\/path\/to\/Cortex/i)).toBeNull();
    expect(screen.queryByText(/uv run/i)).toBeNull();
    expect(screen.queryByText(/CORTEX_USER_TOKEN/i)).toBeNull();
  });

  it('describes the read-only Cortex sources', () => {
    render(<CortexConnectionPanel />);

    expect(screen.getByText(/meetings, email, WhatsApp, SharePoint, timelines and cited evidence/i))
      .toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it('hides the revoke control when the server gate is off', () => {
    render(<CortexConnectionPanel revokeEnabled={false} />);

    expect(screen.queryByText('Advanced')).toBeNull();
    expect(screen.queryByRole('button', { name: /Revoke all Cortex tokens/i })).toBeNull();
  });

  it('keeps manual Cortex token lifetime choices inside collapsed Advanced controls', () => {
    render(<CortexConnectionPanel revokeEnabled />);

    expect(screen.queryByLabelText('Cortex token lifetime')).toBeNull();

    fireEvent.click(screen.getByText('Advanced'));

    const lifetime = screen.getByLabelText('Cortex token lifetime');
    expect(lifetime).toBeInTheDocument();
    expect(lifetime).toHaveTextContent('30 days');
    expect(lifetime).toHaveTextContent('90 days');
    expect(lifetime).toHaveTextContent('1 year');
    expect(lifetime).toHaveTextContent('Never expires');
  });

  it('mints and reveals an indefinite Cortex token through the POST boundary', async () => {
    const network = renderWithNetwork(<CortexConnectionPanel revokeEnabled />, {
      'POST /api/cortex/mcp-token': {
        status: 200,
        body: { data: { token: 'ctx_test_one_time', expiresAt: null } },
      },
    });
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText('Cortex token lifetime'), {
      target: { value: 'never' },
    });
    expect(screen.getByText(/does not expire until you revoke it/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Cortex token' }));
    expect(await screen.findByDisplayValue('ctx_test_one_time')).toBeInTheDocument();
    expect(screen.getByText(/Does not expire — revoke it manually/i)).toBeInTheDocument();
    expect(network.recordedRequests()).toContainEqual({
      method: 'POST',
      path: '/api/cortex/mcp-token',
      json: { lifetime: 'never' },
    });
  });

  it('blocks revoke while a Cortex token mint is pending', async () => {
    renderWithNetwork(<CortexConnectionPanel revokeEnabled />, {
      'POST /api/cortex/mcp-token': { status: 200, pending: true },
    });

    fireEvent.click(screen.getByText('Advanced'));
    const generateButton = screen.getByRole('button', { name: 'Generate Cortex token' });
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(generateButton).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Revoke all Cortex tokens' })).toBeDisabled();
    });
  });

  it('blocks minting while revoking Cortex tokens is pending', async () => {
    renderWithNetwork(<CortexConnectionPanel revokeEnabled />, {
      'DELETE /api/cortex/mcp-token': { status: 200, pending: true },
    });

    fireEvent.click(screen.getByText('Advanced'));
    const generateButton = screen.getByRole('button', { name: 'Generate Cortex token' });
    const revokeButton = screen.getByRole('button', { name: 'Revoke all Cortex tokens' });
    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(generateButton).toBeDisabled();
      expect(revokeButton).toBeDisabled();
    });
  });

  it('clears a revealed Cortex token after successful revoke', async () => {
    const network = renderWithNetwork(<CortexConnectionPanel revokeEnabled />, {
      'POST /api/cortex/mcp-token': {
        status: 200,
        body: { data: { token: 'ctx_clear_on_revoke', expiresAt: null } },
      },
      'DELETE /api/cortex/mcp-token': { status: 200, body: { data: { revoked: true } } },
    });

    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Cortex token' }));
    expect(await screen.findByDisplayValue('ctx_clear_on_revoke')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all Cortex tokens' }));

    await screen.findByRole('status');
    expect(screen.queryByDisplayValue('ctx_clear_on_revoke')).toBeNull();
    expect(network.recordedRequests()).toContainEqual({
      method: 'DELETE',
      path: '/api/cortex/mcp-token',
    });
  });

  it('retains a revealed Cortex token when revoke fails', async () => {
    renderWithNetwork(<CortexConnectionPanel revokeEnabled />, {
      'POST /api/cortex/mcp-token': {
        status: 200,
        body: { data: { token: 'ctx_keep_on_failed_revoke', expiresAt: null } },
      },
      'DELETE /api/cortex/mcp-token': { status: 500, body: { error: { message: 'nope' } } },
    });

    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Cortex token' }));
    expect(await screen.findByDisplayValue('ctx_keep_on_failed_revoke')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all Cortex tokens' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not revoke.*500/i);
    expect(screen.getByDisplayValue('ctx_keep_on_failed_revoke')).toBeInTheDocument();
  });

  it('revokes every Cortex token through the DELETE boundary when enabled', async () => {
    const network = renderWithNetwork(<CortexConnectionPanel revokeEnabled />, {
      'DELETE /api/cortex/mcp-token': {
        status: 200,
        body: { data: { revoked: true } },
      },
    });

    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all Cortex tokens' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      /All your Cortex tokens have been revoked/i,
    );
    expect(network.recordedRequests()).toContainEqual({
      method: 'DELETE',
      path: '/api/cortex/mcp-token',
    });
  });

  it('clears the successful revoke notice as soon as a later mint begins', async () => {
    renderWithNetwork(<CortexConnectionPanel revokeEnabled />, {
      'DELETE /api/cortex/mcp-token': {
        status: 200,
        body: { data: { revoked: true } },
      },
      'POST /api/cortex/mcp-token': { status: 200, pending: true },
    });

    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all Cortex tokens' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      /All your Cortex tokens have been revoked/i,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate Cortex token' }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
  });

  it('surfaces a failed revoke instead of claiming success', async () => {
    renderWithNetwork(<CortexConnectionPanel revokeEnabled />, {
      'DELETE /api/cortex/mcp-token': { status: 404, body: { error: { message: 'nope' } } },
    });

    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all Cortex tokens' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not revoke.*404/i);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
