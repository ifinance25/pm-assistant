export const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

export function routePrefersCollapsedSidebar(pathname: string): boolean {
  return pathname === "/calendar" || pathname.startsWith("/meetings/");
}

export function readSidebarCollapsed(pathname: string): boolean {
  if (typeof localStorage === "undefined") {
    return routePrefersCollapsedSidebar(pathname);
  }
  const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return routePrefersCollapsedSidebar(pathname);
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
}

export function formatStorageMb(usedBytes: number): string {
  if (usedBytes <= 0) {
    return "0";
  }
  return String(Math.max(1, Math.round(usedBytes / (1024 * 1024))));
}

export function formatMeetingCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} расшифровка`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} расшифровки`;
  }
  return `${count} расшифровок`;
}

/** Визуальная шкала полоски в сайдбаре, без облачной квоты. */
export const STORAGE_VISUAL_CAP_BYTES = 512 * 1024 * 1024;

export function storageFillPercent(usedBytes: number): number {
  if (usedBytes <= 0) {
    return 0;
  }
  return Math.min(
    100,
    Math.max(8, Math.round((usedBytes / STORAGE_VISUAL_CAP_BYTES) * 100)),
  );
}
