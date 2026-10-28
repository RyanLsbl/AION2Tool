// JSON-Abrufe bei PlayNC: pro Host eine Warteschlange mit Mindestabstand,
// Pause nach 403/429 und klare Fehlermeldungen.

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const USER_AGENT = 'AION2Tool/1.0 (Checkliste einer AION2-Legion)';
/** Mindestabstand zwischen zwei Anfragen an denselben Host (in Tests per Umgebungsvariable 0) */
const MIN_GAP_MS = Number(process.env.HTTP_MIN_GAP_MS ?? 1500);
const BLOCK_MS = 10 * 60_000;

const queues = new Map<string, Promise<unknown>>();
const lastRequest = new Map<string, number>();
const blockedUntil = new Map<string, number>();

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Austauschbar für Tests. */
export let fetchImpl: typeof fetch = (...args) => fetch(...args);
export function setFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}

export function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const host = new URL(url).host;
  const job = (queues.get(host) ?? Promise.resolve()).then(async () => {
    const blocked = blockedUntil.get(host) ?? 0;
    if (Date.now() < blocked) throw new HttpError(429, `${host} hat Anfragen vorübergehend blockiert – nächster Versuch nach der Pause.`);
    const wait = (lastRequest.get(host) ?? 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest.set(host, Date.now());
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*', ...opts.headers },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (res.status === 403 || res.status === 429) {
      blockedUntil.set(host, Date.now() + BLOCK_MS);
      throw new HttpError(res.status, `${host} antwortet mit ${res.status} – Pause für 10 Minuten.`);
    }
    if (!res.ok) throw new HttpError(res.status, `${host} antwortet mit HTTP ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(res.status, `${host} hat kein JSON geliefert.`);
    }
  });
  queues.set(
    host,
    job.catch(() => undefined),
  );
  return job;
}

/** Setzt Pausen/Abstände zurück (für Tests). */
export function resetHttpState(): void {
  queues.clear();
  lastRequest.clear();
  blockedUntil.clear();
}
