const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata.google.com",
]);

function parseIpv4(host: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return null;
  }
  const parts = match.slice(1, 5).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  if (parts.some((part) => part > 255)) {
    return null;
  }
  return parts;
}

export function isBlockedWebhookHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    return true;
  }
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost")) {
    return true;
  }
  if (host.includes("metadata.google")) {
    return true;
  }
  const ipv4 = parseIpv4(host);
  if (!ipv4) {
    return false;
  }
  const [a, b] = ipv4;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

export function assertPublicWebhookUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("некорректный URL вебхука");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("вебхук должен быть http или https");
  }
  if (isBlockedWebhookHost(parsed.hostname)) {
    throw new Error("вебхук на частный адрес запрещён");
  }
  return trimmed;
}
