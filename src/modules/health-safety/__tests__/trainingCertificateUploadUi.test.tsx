/**
 * The shared certificate upload workflow, from both entry points.
 *
 * One form serves the employee profile (which already knows who) and the H&S
 * module (which does not). The assertions that matter are the ones about
 * timing and honesty: success is announced only after the API confirms both the
 * document and its pending competency rows, and a failure leaves the form open
 * with what the user typed still in it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  swrData: { current: {} as Record<string, unknown> },
}));

vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data: key ? h.swrData.current[key] : undefined,
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn(), query: {} }) }));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/module-page', () => ({
  ModulePage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// H&S pages moved to `healthSafetyConfig` when the module was promoted out of
// Projects; `projectsConfig` stays because other mocked pages still use it.
vi.mock('@/modules/navigation', () => ({ projectsConfig: {}, healthSafetyConfig: {} }));

import React from 'react';
import { TrainingCertificateUploadForm } from '../components/training/TrainingCertificateUploadForm';
import RecordTrainingPage from '../../../../pages/health-safety/training/new';
import { StaffDocumentList } from '@/components/staff/StaffDocumentList';
import { TrainingCertificateRevokeDialog } from '../components/training/TrainingCertificateRevokeDialog';

const STAFF_ID = '11111111-1111-1111-1111-111111111111';
const HEIGHTS = '44444444-4444-4444-4444-444444444444';
const SPLICING = '55555555-5555-5555-5555-555555555555';

function pdf(name = 'cert.pdf') {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.swrData.current = {
    '/api/health-safety/training/types': {
      data: {
        types: [
          { id: HEIGHTS, code: 'working_at_heights', name: 'Working at Heights', is_active: true, requires_certificate: true },
          { id: SPLICING, code: 'fibre_splicing', name: 'Fibre Splicing', is_active: true, requires_certificate: true },
          { id: 'inactive', code: 'old', name: 'Retired Competency', is_active: false, requires_certificate: true },
        ],
      },
    },
    '/api/health-safety/training/pickers': {
      data: { staff: [{ id: STAFF_ID, name: 'Thandi Nkosi' }] },
    },
  };
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: { documentId: 'doc-1', trainingRecordIds: ['tr-1'], verificationStatus: 'pending' },
    }),
  }) as unknown as typeof fetch;
});

async function fillDetails(user: ReturnType<typeof userEvent.setup>, types: string[] = ['Working at Heights']) {
  await user.upload(screen.getByLabelText(/certificate file/i), pdf());
  for (const type of types) {
    await user.click(screen.getByRole('checkbox', { name: new RegExp(type, 'i') }));
  }
  await user.type(screen.getByLabelText(/certificate number/i), 'CERT-001');
  await user.type(screen.getByLabelText(/provider/i), 'Acme Training');
  await user.type(screen.getByLabelText(/completion date/i), '2026-01-15');
}

describe('the staff-profile entry point', () => {
  it('does not ask which employee, and submits the one it was given', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<TrainingCertificateUploadForm staffId={STAFF_ID} onSuccess={onSuccess} onCancel={vi.fn()} />);

    expect(screen.queryByLabelText(/employee/i)).not.toBeInTheDocument();

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /review/i }));
    await user.click(screen.getByRole('button', { name: /submit for verification/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const body = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData;
    expect(body.get('staffId')).toBe(STAFF_ID);
  });
});

describe('the H&S entry point', () => {
  it('requires an employee before it will move to review', async () => {
    const user = userEvent.setup();
    render(<TrainingCertificateUploadForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/employee/i)).toBeInTheDocument();

    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /review/i }));

    expect(await screen.findByText(/select the employee/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('competency selection', () => {
  it('offers only active types', () => {
    render(<TrainingCertificateUploadForm staffId={STAFF_ID} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /working at heights/i })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /retired competency/i })).not.toBeInTheDocument();
  });

  it('shows every selected competency as a chip on review', async () => {
    const user = userEvent.setup();
    render(<TrainingCertificateUploadForm staffId={STAFF_ID} onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await fillDetails(user, ['Working at Heights', 'Fibre Splicing']);
    await user.click(screen.getByRole('button', { name: /review/i }));

    const review = await screen.findByTestId('certificate-review');
    expect(review).toHaveTextContent('Working at Heights');
    expect(review).toHaveTextContent('Fibre Splicing');
  });

  it('will not move to review with no competency selected', async () => {
    const user = userEvent.setup();
    render(<TrainingCertificateUploadForm staffId={STAFF_ID} onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await user.upload(screen.getByLabelText(/certificate file/i), pdf());
    await user.type(screen.getByLabelText(/certificate number/i), 'CERT-001');
    await user.type(screen.getByLabelText(/provider/i), 'Acme Training');
    await user.type(screen.getByLabelText(/completion date/i), '2026-01-15');
    await user.click(screen.getByRole('button', { name: /review/i }));

    expect(await screen.findByText(/at least one training type/i)).toBeInTheDocument();
  });
});

describe('validation before the request is made', () => {
  it('requires a file', async () => {
    const user = userEvent.setup();
    render(<TrainingCertificateUploadForm staffId={STAFF_ID} onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: /working at heights/i }));
    await user.type(screen.getByLabelText(/certificate number/i), 'CERT-001');
    await user.type(screen.getByLabelText(/provider/i), 'Acme Training');
    await user.type(screen.getByLabelText(/completion date/i), '2026-01-15');
    await user.click(screen.getByRole('button', { name: /review/i }));

    expect(await screen.findByText(/select the certificate file/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type', async () => {
    const user = userEvent.setup();
    render(<TrainingCertificateUploadForm staffId={STAFF_ID} onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await user.upload(
      screen.getByLabelText(/certificate file/i),
      new File(['x'], 'cert.exe', { type: 'application/x-msdownload' })
    );
    await user.click(screen.getByRole('checkbox', { name: /working at heights/i }));
    await user.type(screen.getByLabelText(/certificate number/i), 'CERT-001');
    await user.type(screen.getByLabelText(/provider/i), 'Acme Training');
    await user.type(screen.getByLabelText(/completion date/i), '2026-01-15');
    await user.click(screen.getByRole('button', { name: /review/i }));

    expect(await screen.findByText(/pdf, jpg, png/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects an expiry before the completion date', async () => {
    const user = userEvent.setup();
    render(<TrainingCertificateUploadForm staffId={STAFF_ID} onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await fillDetails(user);
    await user.type(screen.getByLabelText(/expiry date/i), '2025-12-31');
    await user.click(screen.getByRole('button', { name: /review/i }));

    expect(await screen.findByText(/expiry date cannot be before/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('success is only ever reported by the API', () => {
  it('does not call onSuccess before the response arrives', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    let resolve: (v: unknown) => void = () => {};
    global.fetch = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; })) as unknown as typeof fetch;

    render(<TrainingCertificateUploadForm staffId={STAFF_ID} onSuccess={onSuccess} onCancel={vi.fn()} />);
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /review/i }));
    await user.click(screen.getByRole('button', { name: /submit for verification/i }));

    // In flight: the optimistic-success bug this guards against would have
    // fired the callback here.
    expect(onSuccess).not.toHaveBeenCalled();

    resolve({
      ok: true,
      json: async () => ({
        success: true,
        data: { documentId: 'doc-1', trainingRecordIds: ['tr-1'], verificationStatus: 'pending' },
      }),
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({
      documentId: 'doc-1',
      trainingRecordIds: ['tr-1'],
      verificationStatus: 'pending',
    }));
  });

  it('leaves the form open with the server error when the API refuses', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        success: false,
        error: { message: 'That certificate number is already recorded' },
      }),
    }) as unknown as typeof fetch;

    render(<TrainingCertificateUploadForm staffId={STAFF_ID} onSuccess={onSuccess} onCancel={vi.fn()} />);
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: /review/i }));
    await user.click(screen.getByRole('button', { name: /submit for verification/i }));

    expect(await screen.findByText(/already recorded/i)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /submit for verification/i })).toBeInTheDocument();
  });
});

describe('the manual training page no longer accepts a typed certificate location', () => {
  beforeEach(() => {
    h.swrData.current = {
      '/api/health-safety/training/types': {
        data: {
          types: [
            { id: HEIGHTS, name: 'Working at Heights', is_statutory: true, requires_certificate: true },
            { id: 'induction', name: 'OHS Site Induction', is_statutory: true, requires_certificate: false },
          ],
        },
      },
      '/api/health-safety/training/pickers': {
        data: { contractors: [], staff: [{ id: STAFF_ID, name: 'Thandi Nkosi' }], team_members: [] },
      },
    };
  });

  it('offers no free-text certificate URL field at all', () => {
    render(<RecordTrainingPage />);
    expect(screen.queryByLabelText(/certificate url/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/https:/i)).not.toBeInTheDocument();
  });

  it('sends a certificate-required competency to the upload flow', async () => {
    const user = userEvent.setup();
    render(<RecordTrainingPage />);

    await user.selectOptions(screen.getByRole('combobox', { name: /training type/i }), HEIGHTS);

    const link = await screen.findByRole('link', { name: /upload the certificate instead/i });
    expect(link).toHaveAttribute('href', '/health-safety/training/certificates/new');
    expect(screen.getByRole('button', { name: /save record/i })).toBeDisabled();
  });

  it('still allows a competency that needs no certificate', async () => {
    const user = userEvent.setup();
    render(<RecordTrainingPage />);

    await user.selectOptions(screen.getByRole('combobox', { name: /training type/i }), 'induction');

    expect(screen.queryByRole('link', { name: /upload the certificate instead/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save record/i })).not.toBeDisabled();
  });
});

describe('restricted viewers do not see certificate actions', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, documents: [], count: 0 }),
    }) as unknown as typeof fetch;
  });

  it('hides the upload action without the certificate permission', async () => {
    render(<StaffDocumentList staffId={STAFF_ID} />);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /upload training certificate/i })).not.toBeInTheDocument()
    );
  });

  it('shows it to a permitted custodian', async () => {
    render(<StaffDocumentList staffId={STAFF_ID} canUploadTrainingCertificate />);
    expect(
      await screen.findByRole('button', { name: /upload training certificate/i })
    ).toBeInTheDocument();
  });
});

describe('revoking verified evidence', () => {
  const DOC_ID = '77777777-7777-7777-7777-777777777777';

  function renderDialog(onRevoked = vi.fn()) {
    render(
      <TrainingCertificateRevokeDialog
        isOpen
        documentId={DOC_ID}
        documentName="Working at Heights certificate"
        onClose={vi.fn()}
        onRevoked={onRevoked}
      />
    );
    return onRevoked;
  }

  it('refuses to submit without a reason', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn() as unknown as typeof fetch;
    renderDialog();

    await user.click(screen.getByRole('button', { name: /revoke certificate/i }));

    expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts the revocation with its reason and reports success only after the API confirms', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { status: 'revoked' } }),
    }) as unknown as typeof fetch;
    const onRevoked = renderDialog();

    await user.type(screen.getByLabelText(/reason/i), 'Issued in error by the provider');
    await user.click(screen.getByRole('button', { name: /revoke certificate/i }));

    await waitFor(() => expect(onRevoked).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`/api/staff-documents/${DOC_ID}/verify`);
    expect(JSON.parse(init.body)).toEqual({
      status: 'revoked',
      notes: 'Issued in error by the provider',
    });
  });

  it('keeps the dialog open with the server error when the API refuses', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        success: false,
        error: { message: 'A rejected certificate cannot be marked revoked' },
      }),
    }) as unknown as typeof fetch;
    const onRevoked = renderDialog();

    await user.type(screen.getByLabelText(/reason/i), 'Withdrawn');
    await user.click(screen.getByRole('button', { name: /revoke certificate/i }));

    expect(await screen.findByText(/cannot be marked revoked/i)).toBeInTheDocument();
    expect(onRevoked).not.toHaveBeenCalled();
  });
});

describe('the revoke action is only offered where it applies', () => {
  const VERIFIED_CERT = {
    id: '77777777-7777-7777-7777-777777777777',
    staffId: STAFF_ID,
    documentType: 'certification',
    documentName: 'Working at Heights certificate',
    verificationStatus: 'verified',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  function renderList(props: Record<string, unknown>, doc = VERIFIED_CERT) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, documents: [doc], count: 1 }),
    }) as unknown as typeof fetch;
    render(<StaffDocumentList staffId={STAFF_ID} {...props} />);
  }

  it('offers it for a verified certificate when permitted', async () => {
    renderList({ canVerifyTrainingCertificate: true });
    expect(await screen.findByRole('button', { name: /revoke working at heights/i })).toBeInTheDocument();
  });

  it('hides it without the permission', async () => {
    renderList({});
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /revoke working at heights/i })).not.toBeInTheDocument()
    );
  });

  it('hides it for a pending certificate — there is nothing verified to withdraw', async () => {
    renderList({ canVerifyTrainingCertificate: true }, { ...VERIFIED_CERT, verificationStatus: 'pending' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /revoke working at heights/i })).not.toBeInTheDocument()
    );
  });
});
