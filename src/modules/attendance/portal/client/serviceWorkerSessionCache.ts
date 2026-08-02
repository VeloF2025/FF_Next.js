const CLEAR_REQUEST = 'CLEAR_SESSION_CACHE';
const CLEAR_ACK = 'SESSION_CACHE_CLEARED';
const ACK_TIMEOUT_MS = 1_500;

export async function clearMyPortalSessionCache(
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker ||
      typeof MessageChannel === 'undefined') return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/my/');
    const worker = registration?.active;
    if (!worker) return false;
    const channel = new MessageChannel();
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (acknowledged: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
        resolve(acknowledged);
      };
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      channel.port1.onmessage = (event) => {
        if (event.data?.type === CLEAR_ACK) finish(true);
      };
      worker.postMessage({ type: CLEAR_REQUEST }, [channel.port2]);
    });
  } catch {
    return false;
  }
}
