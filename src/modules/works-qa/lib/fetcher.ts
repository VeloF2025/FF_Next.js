/**
 * Shared SWR fetcher for works-qa API endpoints.
 *
 * Handles both plain-JSON and apiResponse-envelope shapes
 * ({ success: true, data: T }).
 *
 * // 🟢 WORKING: extracted from WorksQAPage.tsx (T9 refactor).
 */

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as ApiEnvelope<T> | T;
  if (
    body &&
    typeof body === 'object' &&
    'success' in body &&
    (body as ApiEnvelope<T>).data !== undefined
  ) {
    return (body as ApiEnvelope<T>).data as T;
  }
  return body as T;
}
