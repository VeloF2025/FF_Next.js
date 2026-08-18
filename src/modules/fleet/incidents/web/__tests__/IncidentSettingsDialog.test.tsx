/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentSettingsDialog } from '../IncidentSettingsDialog';
import type { IncidentRule, OversightMembership } from '../../types';

const currentRule: IncidentRule = {
  id: 'rule-2', incidentType: 'late', version: 2, effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  enabled: true, createsIncident: true, severity: 'high', immediateNotification: true,
  channels: { inApp: true, email: true, whatsapp: false }, includeInMorningSummary: false,
  acknowledgementTargetMinutes: 15, reminderIntervalMinutes: 15, maximumEscalationLevel: 3, evidenceRequiredOutcomes: ['confirmed'],
};
const previousRule: IncidentRule = { ...currentRule, id: 'rule-1', version: 1, effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveTo: currentRule.effectiveFrom };
const createdRule: IncidentRule = { ...currentRule, id: 'rule-3', version: 3, effectiveFrom: '2099-01-01T00:00:00.000Z' };

const activeMember: OversightMembership = { id: 'membership-1', userId: 'user-active-1', effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: null, reason: null };
const endedMember: OversightMembership = { id: 'membership-0', userId: 'user-ended-1', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-05-01T00:00:00.000Z', reason: 'Role change' };

/** Display names the scoped `/settings/user-search?ids=...` endpoint resolves for each
 * fixture userId — membership rows must render these, never the raw `userId` UUID. */
const NAME_BY_USER_ID: Record<string, string> = {
  'user-active-1': 'Asha Naidoo',
  'user-ended-1': 'Kabelo Mokoena',
  'user-found-1': 'Nomvula Khumalo',
};

function ok(data: unknown, status = 200): Response { return { ok: true, status, json: async () => ({ success: true, data }) } as Response; }
function fail(status: number, code: string, message: string): Response { return { ok: false, status, json: async () => ({ success: false, error: { code, message } }) } as Response; }
async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

const fetchMock = vi.fn<typeof fetch>();

/**
 * A stateful router, not a fixed fixture: `GET` reflects whatever the
 * in-memory `rules`/`members` arrays currently hold, so a test can POST a
 * new rule version or oversight member and then assert the very next GET
 * (triggered by the component's own post-mutation reload) reflects it —
 * exactly what "create a future/effective version" and "add only after the
 * API confirms it" need to prove.
 */
function routeFetch(): { rules: IncidentRule[]; members: OversightMembership[] } {
  const state = { rules: [currentRule, previousRule], members: [activeMember] };
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/settings/rules') && method === 'GET') return Promise.resolve(ok([...state.rules]));
    if (url.includes('/settings/rules') && method === 'POST') {
      state.rules = [createdRule, ...state.rules.map((rule) => (rule.id === currentRule.id ? { ...rule, effectiveTo: createdRule.effectiveFrom } : rule))];
      return Promise.resolve(ok(createdRule, 201));
    }
    if (url.includes('/settings/oversight-members') && method === 'GET' && url.includes('activeOnly=true')) {
      return Promise.resolve(ok(state.members.filter((member) => member.effectiveTo === null)));
    }
    if (url.includes('/settings/oversight-members') && method === 'GET' && url.includes('activeOnly=false')) {
      return Promise.resolve(ok([...state.members, endedMember]));
    }
    if (url.includes('/settings/oversight-members') && method === 'POST') {
      const added: OversightMembership = { id: 'membership-2', userId: 'user-found-1', effectiveFrom: '2026-08-18T08:00:00.000Z', effectiveTo: null, reason: null };
      state.members = [...state.members, added];
      return Promise.resolve(ok(added, 201));
    }
    if (url.includes('/settings/oversight-members') && method === 'DELETE') {
      const ended = { ...activeMember, effectiveTo: '2026-08-18T00:00:00.000Z', reason: 'Left the team' };
      state.members = state.members.map((member) => (member.id === activeMember.id ? ended : member));
      return Promise.resolve(ok(ended));
    }
    if (url.includes('/settings/user-search')) {
      const params = new URL(url, 'http://localhost').searchParams;
      const idsParam = params.get('ids');
      if (idsParam) {
        const users = idsParam.split(',').filter((id) => id in NAME_BY_USER_ID).map((id) => ({ id, name: NAME_BY_USER_ID[id] }));
        return Promise.resolve(ok({ users }));
      }
      const search = params.get('search') ?? '';
      const users = search === 'Nomvula' ? [{ id: 'user-found-1', name: NAME_BY_USER_ID['user-found-1'] }] : [];
      return Promise.resolve(ok({ users }));
    }
    return Promise.resolve(fail(404, 'NOT_FOUND', `Unhandled request: ${url}`));
  });
  return state;
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); routeFetch(); });

describe('IncidentSettingsDialog', () => {
  it('renders nothing while closed', () => {
    render(<IncidentSettingsDialog open={false} onClose={vi.fn()} canEdit />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows current and historical rule versions for a view-only visitor, with no edit controls', async () => {
    render(<IncidentSettingsDialog open onClose={vi.fn()} canEdit={false} />);
    await flush();
    fireEvent.click(screen.getByText(/Version history/));
    expect(screen.getByText(/v2 — effective/)).toBeInTheDocument();
    expect(screen.getByText(/v1 — effective/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create rule version' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search active FibreFlow users')).not.toBeInTheDocument();
  });

  it('lets a settings-authorized user create a future/effective rule version', async () => {
    render(<IncidentSettingsDialog open onClose={vi.fn()} canEdit />);
    await flush();
    fireEvent.change(screen.getByLabelText('Rule effective from'), { target: { value: '2099-01-01T02:00' } });
    fireEvent.change(screen.getByLabelText('Rule change reason'), { target: { value: 'Tighten the late threshold' } });
    const submit = screen.getByRole('button', { name: 'Create rule version' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await flush();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST' && String(fetchMock.mock.calls[0]));
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/incidents/settings/rules', expect.objectContaining({ method: 'POST' }));
    await waitFor(() => expect(screen.getByText(/v3 — effective/)).toBeInTheDocument());
    void post;
  });

  it('finds active FibreFlow users by search — never a hardcoded roster', async () => {
    render(<IncidentSettingsDialog open onClose={vi.fn()} canEdit />);
    await flush();
    fireEvent.change(screen.getByLabelText('Search active FibreFlow users'), { target: { value: 'Nomvula' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await flush();
    expect(screen.getByText(/Nomvula Khumalo/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search active FibreFlow users'), { target: { value: 'Zzz-no-match' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await flush();
    expect(screen.queryByText(/Nomvula Khumalo/)).not.toBeInTheDocument();
  });

  it('adds a searched user to oversight membership only after the API confirms it', async () => {
    render(<IncidentSettingsDialog open onClose={vi.fn()} canEdit />);
    await flush();
    fireEvent.change(screen.getByLabelText('Search active FibreFlow users'), { target: { value: 'Nomvula' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/incidents/settings/oversight-members', expect.objectContaining({ method: 'POST' }));
    // The new row must render the resolved display name, never the raw userId UUID.
    await waitFor(() => expect(screen.getByText('Nomvula Khumalo')).toBeInTheDocument());
    expect(screen.queryByText('user-found-1')).not.toBeInTheDocument();
  });

  it('shows active membership and requires a reason before ending it, rendering a name rather than the raw userId', async () => {
    render(<IncidentSettingsDialog open onClose={vi.fn()} canEdit />);
    await flush();
    await waitFor(() => expect(screen.getByText('Asha Naidoo')).toBeInTheDocument());
    expect(screen.queryByText('user-active-1')).not.toBeInTheDocument();
    const endButton = screen.getByRole('button', { name: 'End' });
    expect(endButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason to end membership for Asha Naidoo'), { target: { value: 'Role change' } });
    expect(endButton).toBeEnabled();
    fireEvent.click(endButton);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/incidents/settings/oversight-members', expect.objectContaining({ method: 'DELETE' }));
  });

  it('shows membership history only on request, with a resolved name rather than the raw userId', async () => {
    render(<IncidentSettingsDialog open onClose={vi.fn()} canEdit />);
    await flush();
    expect(screen.queryByText(/user-ended-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Kabelo Mokoena/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
    await flush();
    await waitFor(() => expect(screen.getByText(/Kabelo Mokoena/)).toBeInTheDocument());
    expect(screen.queryByText(/user-ended-1/)).not.toBeInTheDocument();
  });
});
