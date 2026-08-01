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
import { FibreFlowConnectionPanel } from '../FibreFlowConnectionPanel';
import {
  listResponse,
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

describe('FibreFlowConnectionPanel', () => {
  it('shows active sessions and keeps manual mint collapsed', async () => {
    const network = renderWithNetwork(<FibreFlowConnectionPanel sessionsEnabled />, {
      'GET /api/me/mcp-tokens': listResponse([{
        id: 'session-1',
        label: 'Claude connector',
        createdAt: '2026-07-30T08:00:00.000Z',
        expiresAt: '2026-10-28T08:00:00.000Z',
        lastUsedAt: null,
      }]),
    });

    expect(await screen.findByRole('cell', { name: 'Claude connector' }))
      .toBeInTheDocument();
    expect(screen.getByText(
      'https://app.fibreflow.app/api/ff-remote-mcp/mcp',
    )).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate token' })).toBeNull();
    expect(network.recordedRequests()).toEqual([{
      method: 'GET',
      path: '/api/me/mcp-tokens',
    }]);
  });

  it('reveals manual lifetime, label and mint controls after expanding Advanced', async () => {
    renderWithNetwork(<FibreFlowConnectionPanel sessionsEnabled />, {
      'GET /api/me/mcp-tokens': listResponse([]),
    });
    await screen.findByText(/no active read-only sessions/i);

    fireEvent.click(screen.getByText('Advanced'));

    expect(screen.getByLabelText('Token lifetime')).toBeInTheDocument();
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate token' })).toBeInTheDocument();
  });

  it('reveals a successfully minted token once and preserves the POST contract', async () => {
    const mintedToken = 'ffmcp_one_time_secret';
    const network = renderWithNetwork(<FibreFlowConnectionPanel sessionsEnabled />, {
      'GET /api/me/mcp-tokens': [listResponse([]), listResponse([])],
      'POST /api/me/mcp-tokens': {
        status: 200,
        body: {
          data: {
            token: mintedToken,
            expiresAt: '2026-10-28T08:00:00.000Z',
          },
        },
      },
    });
    await screen.findByText(/no active read-only sessions/i);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Claude desktop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }));

    expect(await screen.findByDisplayValue(mintedToken)).toBeInTheDocument();
    expect(screen.getByText(/it will not be shown again/i)).toBeInTheDocument();
    expect(network.recordedRequests()).toContainEqual({
      method: 'POST',
      path: '/api/me/mcp-tokens',
      json: { lifetime: '30d', label: 'Claude desktop' },
    });
  });

  /**
   * Regression: /api/me/mcp-tokens 404s when FF_MCP_TOKEN_UI_ENABLED is unset
   * (production). Fetching anyway painted a "Could not load your tokens" error
   * across the page for every authenticated user.
   */
  it('makes no token request and shows no error when the server gate is off', async () => {
    const network = renderWithNetwork(<FibreFlowConnectionPanel sessionsEnabled={false} />, {
      'GET /api/me/mcp-tokens': { status: 404, body: { error: { message: 'Endpoint not found' } } },
    });

    expect(await screen.findByText(
      'https://app.fibreflow.app/api/ff-remote-mcp/mcp',
    )).toBeInTheDocument();
    expect(network.recordedRequests()).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Could not load your tokens/i)).toBeNull();
    expect(screen.queryByText('Active sessions')).toBeNull();
    expect(screen.queryByText('Advanced')).toBeNull();
  });

  it('revokes an active session through the existing DELETE boundary', async () => {
    const network = renderWithNetwork(<FibreFlowConnectionPanel sessionsEnabled />, {
      'GET /api/me/mcp-tokens': [
        listResponse([{
          id: 'session-1',
          label: 'Claude connector',
          createdAt: '2026-07-30T08:00:00.000Z',
          expiresAt: '2026-10-28T08:00:00.000Z',
          lastUsedAt: null,
        }]),
        listResponse([]),
      ],
      'DELETE /api/me/mcp-tokens/session-1': {
        status: 200,
        body: { data: { revoked: true } },
      },
    });
    await screen.findByRole('cell', { name: 'Claude connector' });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Claude connector' }))
        .not.toBeInTheDocument();
    });
    expect(network.recordedRequests()).toContainEqual({
      method: 'DELETE',
      path: '/api/me/mcp-tokens/session-1',
    });
  });
});
