import { describe, expect, it } from "vitest";
import {
  TRANSCRIPT_BLOCK_MAX_CHARS,
  frameScrollTopForTarget,
  groupTranscriptSegments,
} from "./group-transcript.ts";

function seg(
  speaker: string,
  text: string,
  startedAtMs: number,
  endedAtMs = startedAtMs + 1000,
) {
  return { speaker, text, startedAtMs, endedAtMs };
}

describe("groupTranscriptSegments", () => {
  it("склеивает подряд идущие реплики одного спикера в один блок", () => {
    const blocks = groupTranscriptSegments([
      seg("Анна", "Первое предложение.", 0),
      seg("Анна", "Второе предложение.", 1200),
      seg("Анна", "Третье.", 2400),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.speaker).toBe("Анна");
    expect(blocks[0]?.text).toBe(
      "Первое предложение. Второе предложение. Третье.",
    );
    expect(blocks[0]?.startedAtMs).toBe(0);
    expect(blocks[0]?.endedAtMs).toBe(3400);
    expect(blocks[0]?.parts).toHaveLength(3);
  });

  it("начинает новый блок при смене спикера", () => {
    const blocks = groupTranscriptSegments([
      seg("Анна", "Привет.", 0),
      seg("Иван", "Здравствуй.", 800),
      seg("Анна", "Как дела?", 1600),
    ]);
    expect(blocks.map((block) => block.speaker)).toEqual([
      "Анна",
      "Иван",
      "Анна",
    ]);
    expect(blocks.map((block) => block.text)).toEqual([
      "Привет.",
      "Здравствуй.",
      "Как дела?",
    ]);
  });

  it("режет длинный абзац по предложениям около лимита, не посередине фразы", () => {
    const first = `${"А".repeat(500)} готово.`;
    const second = `${"Б".repeat(500)} тоже.`;
    const third = `${"В".repeat(500)} конец.`;
    expect(first.length + 1 + second.length).toBeGreaterThan(
      TRANSCRIPT_BLOCK_MAX_CHARS,
    );
    const blocks = groupTranscriptSegments([
      seg("Спикер 1", first, 0, 5000),
      seg("Спикер 1", second, 5000, 10_000),
      seg("Спикер 1", third, 10_000, 15_000),
    ]);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      expect(block.text.endsWith(".")).toBe(true);
      expect(block.text.includes("готово.тоже")).toBe(false);
    }
    expect(blocks[0]?.text).toContain("готово.");
    expect(blocks[0]?.text).not.toContain("конец.");
    expect(blocks.at(-1)?.text).toContain("конец.");
    const joined = blocks.map((block) => block.text).join(" ");
    expect(joined).toContain("готово.");
    expect(joined).toContain("тоже.");
    expect(joined).toContain("конец.");
  });

  it("не режет одно предложение длиннее лимита", () => {
    const longSentence = `${"слово ".repeat(200).trim()}.`;
    expect(longSentence.length).toBeGreaterThan(TRANSCRIPT_BLOCK_MAX_CHARS);
    const blocks = groupTranscriptSegments([
      seg("Спикер 1", longSentence, 0, 8000),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text).toBe(longSentence);
  });

  it("следующий блок начинается со следующего предложения", () => {
    const a = `${"а".repeat(600)}.`;
    const b = `${"б".repeat(600)}.`;
    const blocks = groupTranscriptSegments([
      seg("Спикер 1", `${a} ${b}`, 0, 4000),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toBe(a);
    expect(blocks[1]?.text).toBe(b);
  });

  it("считает прокрутку так, чтобы цель встала на верх фрейма", () => {
    expect(frameScrollTopForTarget(120, 40, 360)).toBe(280);
    expect(frameScrollTopForTarget(200, 0, 80)).toBe(0);
  });
});
