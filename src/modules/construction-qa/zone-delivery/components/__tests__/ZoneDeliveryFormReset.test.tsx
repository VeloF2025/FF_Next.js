import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HandoverEvidencePanel } from '../HandoverEvidencePanel';
import { PonMilestoneTable } from '../PonMilestoneTable';
import { ZoneQaPanels } from '../ZoneQaPanels';
import { snagId, zoneFixture } from './zoneDeliveryWorkspaceFixture';

const fillAudit = () => {
  fireEvent.change(screen.getByLabelText('Effective date and time'), {
    target: { value: '2026-07-30T08:00' },
  });
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Old source' } });
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Old reason' } });
};

const expectBlankAudit = () => {
  expect(screen.getByLabelText('Effective date and time')).toHaveValue('');
  expect(screen.getByLabelText('Source')).toHaveValue('');
  expect(screen.getByLabelText(/Reason/)).toHaveValue('');
};

describe('Zone Delivery command form resets', () => {
  it('resets scope and milestone state for each newly opened command', async () => {
    const onMilestone = vi.fn().mockResolvedValue(true);
    render(<PonMilestoneTable
      zone={zoneFixture}
      permissions={{ scope: true, construction: true, testing: true, operations: true }}
      mutating={false}
      onScope={vi.fn().mockResolvedValue(true)}
      onMilestone={onMilestone}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage scope' }));
    fireEvent.change(screen.getByLabelText('Scope reason PON 5'), {
      target: { value: 'Unsaved stale reason' },
    });
    fillAudit();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage scope' }));
    expect(screen.getByLabelText('Scope reason PON 5')).toHaveValue('Not built');
    expectBlankAudit();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reopen Testing passed for PON 4' }));
    fireEvent.change(screen.getByLabelText('Snag ID'), { target: { value: snagId } });
    fillAudit();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit audited action' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Testing passed for PON 4' }));
    expect(screen.getByLabelText('Snag ID')).toHaveValue('');
    expectBlankAudit();
  });

  it('resets QA-specific and audit state after a successful command', async () => {
    render(<ZoneQaPanels
      zone={zoneFixture}
      canApprove
      mutating={false}
      onRecord={vi.fn().mockResolvedValue(true)}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Record Optical Zone QA' }));
    fireEvent.change(screen.getByLabelText('QA status'), { target: { value: 'failed' } });
    fireEvent.change(screen.getByLabelText('QA notes'), { target: { value: 'Old notes' } });
    fireEvent.change(screen.getByLabelText('Snag IDs'), { target: { value: snagId } });
    fillAudit();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit audited action' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record Optical Zone QA' }));
    expect(screen.getByLabelText('QA status')).toHaveValue('in_progress');
    expect(screen.getByLabelText('QA notes')).toHaveValue('');
    expect(screen.getByLabelText('Snag IDs')).toHaveValue('');
    expectBlankAudit();
  });

  it('resets document-specific and audit state after a successful upload', async () => {
    const onUpload = vi.fn().mockResolvedValue(true);
    render(<HandoverEvidencePanel
      zone={zoneFixture}
      canManage
      mutating={false}
      onUpload={onUpload}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Upload evidence' }));
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'test_pack' } });
    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [new File(['evidence'], 'pack.pdf', { type: 'application/pdf' })] },
    });
    fillAudit();
    await act(async () => {
      fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload evidence' }));
    expect(screen.getByLabelText('Document type')).toHaveValue('fac');
    expect(screen.getByLabelText('File')).toHaveValue('');
    expectBlankAudit();
  });
});
