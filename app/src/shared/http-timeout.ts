export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export function externalFetchTimeoutMs(): number {
  const raw = Number(process.env.PM_ASSISTANT_FETCH_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_FETCH_TIMEOUT_MS;
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

export function timeoutSignal(ms = externalFetchTimeoutMs()): AbortSignal {
  return AbortSignal.timeout(ms);
}

export function withTimeoutSignal(
  init: RequestInit | undefined,
  ms = externalFetchTimeoutMs(),
): RequestInit {
  const extra = timeoutSignal(ms);
  const existing = init?.signal;
  const signal =
    existing && typeof AbortSignal.any === "function"
      ? AbortSignal.any([existing, extra])
      : extra;
  return { ...init, signal };
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  ms = externalFetchTimeoutMs(),
): Promise<Response> {
  return fetch(input, withTimeoutSignal(init, ms));
}
