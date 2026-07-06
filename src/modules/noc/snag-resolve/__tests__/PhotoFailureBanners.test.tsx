import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PhotoFailureBanners } from '../PhotoFailureBanners';
import type { DroppedItem } from '@/lib/offline-queue';
import type { PendingSnagPhoto } from '../offline/photoQueue';

function droppedItem(id: string, slotKey?: string): DroppedItem<PendingSnagPhoto> {
  return {
    id,
    payload: {
      token: 'tok', stepId: 'step-1', slotKey, actorId: 'a',
      clientUploadId: '11111111-2222-4333-8444-555555555555',
      photoBlob: new Blob([new Uint8Array(1)]), filename: 'p.jpg', mimeType: 'image/jpeg',
      byteSize: 1, capturedAt: '2026-07-06T00:00:00.000Z',
    },
    queuedAt: '2026-07-06T00:00:00.000Z',
    attempts: 1,
    droppedAt: '2026-07-06T00:01:00.000Z',
    dropReason: 'step is already complete — uploads are locked',
    byteSize: 1,
  };
}

describe('PhotoFailureBanners', () => {
  const noop = () => {};

  it('renders nothing when there is no failure', () => {
    const { container } = render(
      <PhotoFailureBanners notSaved={null} onClearNotSaved={noop} dropped={[]} onAcknowledgeDropped={noop} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the emphatic not_saved banner as an alert and clears on dismiss', () => {
    const onClear = vi.fn();
    render(
      <PhotoFailureBanners notSaved="This photo was NOT saved." onClearNotSaved={onClear} dropped={[]} onAcknowledgeDropped={noop} />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Photo NOT saved');
    expect(alert).toHaveTextContent('This photo was NOT saved.');
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('renders a rejected-photo banner per dropped item with the reason, and acknowledges by id', () => {
    const onAck = vi.fn();
    render(
      <PhotoFailureBanners
        notSaved={null}
        onClearNotSaved={noop}
        dropped={[droppedItem('d1', 'front'), droppedItem('d2', 'back')]}
        onAcknowledgeDropped={onAck}
      />
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent('Photo rejected — not uploaded');
    expect(alerts[0]).toHaveTextContent('step is already complete');
    expect(alerts[0]).toHaveTextContent('front');
    fireEvent.click(screen.getAllByLabelText('Dismiss')[1]);
    expect(onAck).toHaveBeenCalledWith('d2');
  });
});
