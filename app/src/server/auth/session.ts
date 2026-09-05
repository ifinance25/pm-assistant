export const SESSION_COOKIE = "pm_assistant_session";
export const OAUTH_STATE_COOKIE = "pm_assistant_oauth_state";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isSecureRequest(headers: {
  get(name: string): string | undefined | null;
}): boolean {
  if (process.env.PM_ASSISTANT_COOKIE_SECURE === "1") {
    return true;
  }
  const proto = headers.get("x-forwarded-proto") ?? "";
  return proto.split(",")[0]?.trim() === "https";
}

export function sessionCookieOptions(expiresAt: Date, secure = false): string {
  const parts = [
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearSessionCookie(secure = false): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function userInitials(displayName: string): string {
  const chunks = displayName.trim().split(/\s+/).filter(Boolean);
  if (chunks.length === 0) {
    return "?";
  }
  if (chunks.length === 1) {
    return chunks[0].slice(0, 2).toUpperCase();
  }
  return `${chunks[0][0] ?? ""}${chunks[1][0] ?? ""}`.toUpperCase();
}
