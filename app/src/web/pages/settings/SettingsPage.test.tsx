import { describe, expect, it } from "vitest";
import { projectsLoadError } from "./SettingsPage.tsx";

describe("projectsLoadError", () => {
  it("подсказывает перезапуск API при 404", () => {
    expect(projectsLoadError(404)).toContain("Перезапустите API");
    expect(projectsLoadError(404)).toContain("0.2.0");
  });

  it("даёт общую ошибку для других статусов", () => {
    expect(projectsLoadError(500)).toBe("Не удалось загрузить проекты");
    expect(projectsLoadError(401)).toBe("Не удалось загрузить проекты");
  });
});
