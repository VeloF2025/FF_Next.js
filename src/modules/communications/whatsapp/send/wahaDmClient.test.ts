import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendWahaDm, formatPhoneForWaha } from './wahaDmClient';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function lastBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

describe('formatPhoneForWaha', () => {
  it.each([
    ['0821234567', '27821234567@c.us'],
    ['+27821234567', '27821234567@c.us'],
    ['27821234567', '27821234567@c.us'],
    ['082 123 4567', '27821234567@c.us'],
    ['(082) 123-4567', '27821234567@c.us'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatPhoneForWaha(input)).toBe(expected);
  });
});

describe('sendWahaDm', () => {
  it('posts the message to the WAHA sendText endpoint', async () => {
    await sendWahaDm('0821234567', 'hello');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/sendText');
    expect(init.method).toBe('POST');
    expect(lastBody()).toMatchObject({ chatId: '27821234567@c.us', text: 'hello' });
  });

  it('carries a session so WAHA knows which account to send from', async () => {
    await sendWahaDm('27821234567', 'hi');
    expect(lastBody().session).toBeTruthy();
  });

  it('bounds the request with an abort signal', async () => {
    await sendWahaDm('27821234567', 'hi');
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
  });

  // The throw-on-failure contract is what waSendClient converts into
  // {ok:false} and what deliverWhatsApp's outer catch relies on. Swallowing it
  // here would turn a failed send into a silent success upstream.
  it('throws with the status and body when WAHA rejects the send', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => 'bad gateway' });

    await expect(sendWahaDm('27821234567', 'hi')).rejects.toThrow(/502/);
    await expect(sendWahaDm('27821234567', 'hi')).rejects.toThrow(/bad gateway/);
  });

  it('still throws when the error body cannot be read', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error('stream closed');
      },
    });

    await expect(sendWahaDm('27821234567', 'hi')).rejects.toThrow(/500/);
  });
});
