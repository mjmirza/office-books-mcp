import { TokenBucket } from "./rate-limit.js";

export const BASE_URL = "https://api.lexware.io";

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export class LexwareApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "LexwareApiError";
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  accept?: string;
}

export interface ClientOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  bucket?: TokenBucket;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface LexwareClient {
  request(method: Method, path: string, opts?: RequestOptions): Promise<unknown>;
}

const STATUS_HINT: Record<number, string> = {
  401: "Lexware rejected the API key. Check LEXWARE_API_KEY, keys expire after at most 24 months.",
  403: "This API key may not do that. The Public API needs the Lexware Office XL plan.",
  404: "Lexware could not find that resource.",
  406: "Lexware refused the request content type.",
  409: "Lexware reported a conflict, usually an outdated version field. Read the resource again and retry.",
  415: "Lexware refused the request media type.",
  429: "Lexware rate limit reached (2 requests per second).",
};

function checkPath(path: string): void {
  if (!path.startsWith("/v1/") || path.includes("..") || path.includes("//")) {
    throw new LexwareApiError(0, `Path must start with /v1/ and stay inside the Lexware API: ${path}`);
  }
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const u = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  if ((res.headers.get("content-type") ?? "").includes("json")) {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function errorDetails(res: Response): Promise<unknown> {
  try {
    return await readBody(res);
  } catch {
    return undefined;
  }
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

export function createClient(o: ClientOptions): LexwareClient {
  const doFetch = o.fetch ?? globalThis.fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const bucket = o.bucket ?? new TokenBucket({ capacity: 2, refillPerSecond: 2 });
  const timeoutMs = o.timeoutMs ?? 30_000;
  const maxRetries = o.maxRetries ?? 3;

  async function request(method: Method, path: string, opts: RequestOptions = {}): Promise<unknown> {
    checkPath(path);
    const url = buildUrl(path, opts.query);
    const safe = method === "GET";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${o.apiKey}`,
      Accept: opts.accept ?? "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);

    // Each attempt depends on the previous outcome, so attempts run one after another.
    const attempt = async (n: number): Promise<unknown> => {
      const backoff = Math.min(8000, 500 * 2 ** n) + Math.floor(Math.random() * 250);
      await bucket.take();
      let res: Response;
      try {
        res = await doFetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        if (safe && n < maxRetries) return sleep(backoff).then(() => attempt(n + 1));
        if (isTimeout(e)) throw new LexwareApiError(0, `Lexware did not answer in time, the request timed out after ${timeoutMs} ms.`);
        if (!safe) throw new LexwareApiError(0, "Network error during a write. The change may or may not have been applied. Read the resource before retrying.");
        throw new LexwareApiError(0, `Network error talking to Lexware: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (res.ok) return readBody(res);

      // A 429 means Lexware did not perform the call, so a retry is safe for every method.
      const retryable = res.status === 429 || (safe && res.status >= 500);
      if (retryable && n < maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        return sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff).then(() => attempt(n + 1));
      }
      throw new LexwareApiError(res.status, STATUS_HINT[res.status] ?? `Lexware answered HTTP ${res.status}.`, await errorDetails(res));
    };
    return attempt(0);
  }

  return { request };
}
