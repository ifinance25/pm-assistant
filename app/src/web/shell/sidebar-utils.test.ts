import { describe, expect, it } from "vitest";
import {
  formatMeetingCount,
  formatStorageMb,
  routeLocksWorkspace,
  routePrefersCollapsedSidebar,
  storageFillPercent,
} from "./sidebar-utils.ts";

describe("sidebar-utils", () => {
  it("сворачивает сайдбар на календаре и расшифровке", () => {
    expect(routePrefersCollapsedSidebar("/calendar")).toBe(true);
    expect(routePrefersCollapsedSidebar("/meetings/abc")).toBe(true);
    expect(routePrefersCollapsedSidebar("/")).toBe(false);
  });

  it("фиксирует рабочую область на экране встречи", () => {
    expect(routeLocksWorkspace("/meetings/abc")).toBe(true);
    expect(routeLocksWorkspace("/")).toBe(false);
    expect(routeLocksWorkspace("/archive")).toBe(false);
  });

  it("форматирует хранилище и счётчик расшифровок", () => {
    expect(formatStorageMb(0)).toBe("0");
    expect(formatStorageMb(184 * 1024 * 1024)).toBe("184");
    expect(formatMeetingCount(1)).toBe("1 расшифровка");
    expect(formatMeetingCount(3)).toBe("3 расшифровки");
    expect(formatMeetingCount(5)).toBe("5 расшифровок");
    expect(storageFillPercent(0)).toBe(0);
    expect(storageFillPercent(184 * 1024 * 1024)).toBe(36);
  });
});
