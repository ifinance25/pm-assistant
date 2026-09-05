function splitEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function authAllowlist(): string[] {
  const listed = splitEmails(process.env.PM_ASSISTANT_AUTH_ALLOWLIST);
  const seed = splitEmails(process.env.PM_ASSISTANT_AUTH_EMAIL);
  return [...new Set([...listed, ...seed])];
}

export function isEmailAllowed(email: string): boolean {
  const list = authAllowlist();
  if (list.length === 0) {
    return true;
  }
  return list.includes(email.trim().toLowerCase());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
