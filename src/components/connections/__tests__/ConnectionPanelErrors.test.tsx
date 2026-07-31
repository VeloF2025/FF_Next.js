/**
 * @vitest-environment jsdom
 */
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { FibreFlowConnectionPanel } from '../FibreFlowConnectionPanel';
import {
  listResponse,
  renderWithNetwork,
  resetNetwork,
} from './connections-network';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function activeSessionsCard(): HTMLElement {
  const card = screen.getByRole('heading', { name: 'Active sessions' })
    .closest('section');
  if (!card) throw new Error('Active sessions card not found');
  return card;
}

function advancedCard(): HTMLElement {
  const card = screen.getByText('Advanced').closest('details');
  if (!card) throw new Error('Advanced card not found');
  return card;
}

function installRejectingClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error('clipboard unavailable');
      },
    },
  });
}

afterEach(() => {
  resetNetwork();
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

describe('FibreFlow connection errors', () => {
  it('announces list failures inside Active sessions', async () => {
    renderWithNetwork(<FibreFlowConnectionPanel />, {
      'GET /api/me/mcp-tokens': { status: 503 },
    });

    const alert = await within(activeSessionsCard()).findByRole('alert');
    expect(alert).toHaveTextContent(/could not load your tokens.*503/i);
  });

  it('announces POST failures inside Advanced and not Active sessions', async () => {
    renderWithNetwork(<FibreFlowConnectionPanel />, {
      'GET /api/me/mcp-tokens': listResponse([]),
      'POST /api/me/mcp-tokens': {
        status: 400,
        body: {
          error: {
            message: 'Active session limit reached.',
          },
        },
      },
    });
    await screen.findByText(/no active read-only sessions/i);
    fireEvent.click(screen.getByText('Advanced'));

    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }));

    const alert = await within(advancedCard()).findByRole('alert');
    expect(alert).toHaveTextContent(/active session limit reached/i);
    expect(within(activeSessionsCard()).queryByRole('alert')).toBeNull();
  });

  it('announces clipboard rejection next to the Copy action', async () => {
    installRejectingClipboard();
    renderWithNetwork(<FibreFlowConnectionPanel />, {
      'GET /api/me/mcp-tokens': [listResponse([]), listResponse([])],
      'POST /api/me/mcp-tokens': {
        status: 200,
        body: {
          data: {
            token: 'ffmcp_one_time_secret',
            expiresAt: '2026-10-28T08:00:00.000Z',
          },
        },
      },
    });
    await screen.findByText(/no active read-only sessions/i);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }));
    const copy = await screen.findByRole('button', { name: 'Copy' });
    await act(async () => {
      fireEvent.click(copy);
    });

    const alert = await within(advancedCard()).findByRole('alert');
    expect(alert).toHaveTextContent(/copy failed.*select the text/i);
    expect(within(activeSessionsCard()).queryByRole('alert')).toBeNull();
  });

  it('encodes reserved characters in the DELETE session id segment', async () => {
    const sessionId = 'session/with?reserved';
    const encodedId = 'session%2Fwith%3Freserved';
    const network = renderWithNetwork(<FibreFlowConnectionPanel />, {
      'GET /api/me/mcp-tokens': [
        listResponse([{
          id: sessionId,
          label: 'Reserved id session',
          createdAt: '2026-07-30T08:00:00.000Z',
          expiresAt: '2026-10-28T08:00:00.000Z',
          lastUsedAt: null,
        }]),
        listResponse([]),
      ],
      [`DELETE /api/me/mcp-tokens/${encodedId}`]: {
        status: 200,
        body: { data: { revoked: true } },
      },
    });
    await screen.findByRole('cell', { name: 'Reserved id session' });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(network.recordedRequests()).toContainEqual({
        method: 'DELETE',
        path: `/api/me/mcp-tokens/${encodedId}`,
      });
    });
  });
});
