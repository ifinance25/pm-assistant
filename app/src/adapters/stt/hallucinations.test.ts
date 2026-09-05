import { describe, expect, it } from "vitest";
import { dropHallucinations, isHallucination } from "./hallucinations.ts";

describe("isHallucination", () => {
  it("узнаёт заученные титры Whisper из реальных расшифровок проекта", () => {
    expect(isHallucination("Продолжение следует...")).toBe(true);
    expect(isHallucination("субтитры создавал DimaTorzok")).toBe(true);
    expect(isHallucination("Субтитры создавал DimaTorzok")).toBe(true);
    expect(isHallucination("Редактор субтитров А.Синецкая")).toBe(true);
    expect(isHallucination("Подписывайтесь на канал!")).toBe(true);
  });

  it("пустой сегмент считает мусором", () => {
    expect(isHallucination("")).toBe(true);
    expect(isHallucination("   ...  ")).toBe(true);
  });

  it("живую речь не трогает", () => {
    expect(isHallucination("всем добрые дни коллеги время 18.30")).toBe(false);
    expect(isHallucination("давайте начнем с блокеров")).toBe(false);
  });

  it("длинную реплику, начинающуюся как титры, оставляет", () => {
    const real =
      "Спасибо за просмотр записи прошлой встречи, теперь давайте разберём " +
      "статус по релизу и решим, кто берёт на себя хотфикс до пятницы";
    expect(isHallucination(real)).toBe(false);
  });
});

describe("dropHallucinations", () => {
  it("выбрасывает выдуманные сегменты и сохраняет порядок остальных", () => {
    const segments = [
      {
        speaker: "Спикер 1",
        startedAtMs: 0,
        endedAtMs: 21700,
        text: "тестовая запись 4 сентября мы перезапустили бота",
      },
      {
        speaker: "Спикер 1",
        startedAtMs: 30000,
        endedAtMs: 60000,
        text: "субтитры создавал DimaTorzok",
      },
      {
        speaker: "Спикер 1",
        startedAtMs: 60000,
        endedAtMs: 62000,
        text: "Субтитры создавал DimaTorzok",
      },
    ];
    const kept = dropHallucinations(segments);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.startedAtMs).toBe(0);
  });
});
