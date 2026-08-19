/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  submitMyFleetIncidentResponse: vi.fn(),
  uploadMyFleetIncidentEvidence: vi.fn(),
  DriverIncidentApiError: class DriverIncidentApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); this.name = 'DriverIncidentApiError'; }
  },
}));
vi.mock('../driverIncidentApi', () => api);

import { DriverResponseForm } from '../DriverResponseForm';

const INCIDENT = '11111111-1111-4111-8111-111111111111';

function renderForm(hasResponded = false) {
  const onSubmitted = vi.fn();
  render(
    <DriverResponseForm
      incidentId={INCIDENT}
      enabledConcernCategories={['assignment_error', 'other']}
      hasResponded={hasResponded}
      onSubmitted={onSubmitted}
    />,
  );
  return { onSubmitted };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { vi.clearAllMocks(); });

describe('DriverResponseForm', () => {
  it('only offers the configured/enabled concern categories', () => {
    renderForm();
    expect(screen.getByRole('option', { name: /assignment/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /something else/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /vehicle/i })).not.toBeInTheDocument();
  });

  it('submits as a "response" the first time and "follow_up" once the driver has already responded', async () => {
    api.submitMyFleetIncidentResponse.mockResolvedValue({ submissionId: 's1', incidentId: INCIDENT, driverInputState: 'responded', created: true });
    const user = userEvent.setup();
    renderForm(false);

    await user.type(screen.getByLabelText(/explanation/i), 'I was at the correct site the whole time.');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(api.submitMyFleetIncidentResponse).toHaveBeenCalledWith(
      INCIDENT, expect.objectContaining({ submissionKind: 'response', explanation: 'I was at the correct site the whole time.' }),
    ));
  });

  it('sends follow_up when the driver has already responded', async () => {
    api.submitMyFleetIncidentResponse.mockResolvedValue({ submissionId: 's2', incidentId: INCIDENT, driverInputState: 'responded', created: true });
    const user = userEvent.setup();
    renderForm(true);

    await user.type(screen.getByLabelText(/explanation/i), 'Adding more detail.');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(api.submitMyFleetIncidentResponse).toHaveBeenCalledWith(
      INCIDENT, expect.objectContaining({ submissionKind: 'follow_up' }),
    ));
  });

  it('preserves the entered explanation and re-uses the same idempotency key when the submit fails', async () => {
    api.submitMyFleetIncidentResponse.mockRejectedValueOnce(new api.DriverIncidentApiError(500, 'INTERNAL_ERROR', 'could not persist'));
    api.submitMyFleetIncidentResponse.mockResolvedValueOnce({ submissionId: 's3', incidentId: INCIDENT, driverInputState: 'responded', created: true });
    const user = userEvent.setup();
    renderForm(false);

    const textarea = screen.getByLabelText(/explanation/i);
    await user.type(textarea, 'My explanation text.');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await screen.findByRole('alert');
    expect(textarea).toHaveValue('My explanation text.');

    await user.click(screen.getByRole('button', { name: /retry|submit/i }));

    await waitFor(() => expect(api.submitMyFleetIncidentResponse).toHaveBeenCalledTimes(2));
    const [firstIncidentId, firstArgs] = api.submitMyFleetIncidentResponse.mock.calls[0]!;
    const [, secondArgs] = api.submitMyFleetIncidentResponse.mock.calls[1]!;
    expect(firstIncidentId).toBe(INCIDENT);
    expect(secondArgs.idempotencyKey).toBe(firstArgs.idempotencyKey);
  });

  it('uses a NEW idempotency key for the next submission after a success', async () => {
    api.submitMyFleetIncidentResponse.mockResolvedValue({ submissionId: 's4', incidentId: INCIDENT, driverInputState: 'responded', created: true });
    const user = userEvent.setup();
    renderForm(false);

    await user.type(screen.getByLabelText(/explanation/i), 'First explanation.');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(api.submitMyFleetIncidentResponse).toHaveBeenCalledTimes(1));
    const firstKey = api.submitMyFleetIncidentResponse.mock.calls[0]![1].idempotencyKey;

    await user.type(screen.getByLabelText(/explanation/i), 'Follow-up note.');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(api.submitMyFleetIncidentResponse).toHaveBeenCalledTimes(2));
    const secondKey = api.submitMyFleetIncidentResponse.mock.calls[1]![1].idempotencyKey;

    expect(secondKey).not.toBe(firstKey);
  });

  it('uploads a selected file only after the text explanation is accepted (sequential text-then-file)', async () => {
    let resolveSubmit: (value: unknown) => void = () => {};
    api.submitMyFleetIncidentResponse.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve; }));
    api.uploadMyFleetIncidentEvidence.mockResolvedValue({ evidenceId: 'e1', incidentId: INCIDENT, storageUrl: '/storage/x.jpg' });
    const user = userEvent.setup();
    renderForm(false);

    await user.type(screen.getByLabelText(/explanation/i), 'Photo attached.');
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/attach/i), file);
    await user.click(screen.getByRole('button', { name: /submit/i }));

    // Evidence upload must not fire before the text submission resolves.
    expect(api.uploadMyFleetIncidentEvidence).not.toHaveBeenCalled();

    resolveSubmit({ submissionId: 's5', incidentId: INCIDENT, driverInputState: 'responded', created: true });
    await waitFor(() => expect(api.uploadMyFleetIncidentEvidence).toHaveBeenCalledTimes(1));
    expect(api.uploadMyFleetIncidentEvidence).toHaveBeenCalledWith(INCIDENT, expect.objectContaining({ filename: 'photo.jpg', mimeType: 'image/jpeg' }));
  });

  it('offers a per-file retry when an evidence upload fails, without discarding the accepted text response', async () => {
    api.submitMyFleetIncidentResponse.mockResolvedValue({ submissionId: 's6', incidentId: INCIDENT, driverInputState: 'responded', created: true });
    api.uploadMyFleetIncidentEvidence.mockRejectedValueOnce(new api.DriverIncidentApiError(500, 'INTERNAL_ERROR', 'upload failed'));
    api.uploadMyFleetIncidentEvidence.mockResolvedValueOnce({ evidenceId: 'e2', incidentId: INCIDENT, storageUrl: '/storage/y.jpg' });
    const user = userEvent.setup();
    renderForm(false);

    await user.type(screen.getByLabelText(/explanation/i), 'Photo attached.');
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/attach/i), file);
    await user.click(screen.getByRole('button', { name: /submit/i }));

    const retryButton = await screen.findByRole('button', { name: /retry photo\.jpg|retry upload/i });
    await user.click(retryButton);

    await waitFor(() => expect(api.uploadMyFleetIncidentEvidence).toHaveBeenCalledTimes(2));
  });
});
