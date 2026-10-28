// Aufrufe der Server-API.

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'aion2tool', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // keine JSON-Antwort
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string };
    throw new ApiError(d.error ?? `Fehler ${res.status}`, res.status, d.code);
  }
  return data as T;
}

export const get = <T>(url: string) => api<T>('GET', url);
export const post = <T>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const put = <T>(url: string, body: unknown = {}) => api<T>('PUT', url, body);
export const del = <T>(url: string) => api<T>('DELETE', url);
