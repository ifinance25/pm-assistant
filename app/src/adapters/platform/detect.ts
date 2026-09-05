import type { Platform } from "../../shared/types.ts";

export function detectPlatform(url: string): Platform | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    return "zoom";
  }
  if (host === "meet.google.com") {
    return "meet";
  }
  if (
    host === "telemost.yandex.ru" ||
    host.endsWith(".telemost.yandex.ru") ||
    host === "telemost.yandex.com"
  ) {
    return "telemost";
  }
  return null;
}
