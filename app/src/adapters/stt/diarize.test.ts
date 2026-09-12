import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applySpeakerTimeline,
  assignSpeakers,
  loadSpeakerTimeline,
  loadTrimOffsetMs,
} from "./diarize.ts";
import type { SttSegment } from "./index.ts";

function segment(
  startedAtMs: number,
  endedAtMs: number | null,
  text = "текст",
): SttSegment {
  return { speaker: "Спикер 1", startedAtMs, endedAtMs, text };
}

describe("assignSpeakers", () => {
  it("без таймлайна оставляет сегменты как есть", () => {
    const segments = [segment(0, 1000)];
    expect(assignSpeakers(segments, [])).toBe(segments);
  });

  it("сегмент до первой отметки получает первого спикера", () => {
    const timeline = [
      { atMs: 500, name: "Аня" },
      { atMs: 3000, name: "Боря" },
    ];
    const result = assignSpeakers([segment(0, 400)], timeline);
    expect(result[0].speaker).toBe("Аня");
  });

  it("ставит того, кто говорил дольше в окне сегмента", () => {
    const timeline = [
      { atMs: 0, name: "Аня" },
      { atMs: 1000, name: "Боря" },
      { atMs: 1200, name: "Аня" },
    ];
    // Сегмент 800-1600: Аня 800-1000 (200мс) + 1200-1600 (400мс) = 600мс, Боря 1000-1200 (200мс)
    const result = assignSpeakers([segment(800, 1600)], timeline);
    expect(result[0].speaker).toBe("Аня");
  });

  it("не трогает поля text/startedAtMs/endedAtMs", () => {
    const timeline = [{ atMs: 0, name: "Аня" }];
    const [result] = assignSpeakers([segment(0, 100, "привет")], timeline);
    expect(result).toEqual({
      speaker: "Аня",
      startedAtMs: 0,
      endedAtMs: 100,
      text: "привет",
    });
  });
});

describe("файлы таймлайна и смещения", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pm-diarize-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loadSpeakerTimeline: нет файла -> пусто", () => {
    expect(loadSpeakerTimeline(join(dir, "нет.json"))).toEqual([]);
  });

  it("loadSpeakerTimeline: битый json -> пусто, не бросает", async () => {
    const path = join(dir, "m1.speakers.json");
    await writeFile(path, "{не json");
    expect(loadSpeakerTimeline(path)).toEqual([]);
  });

  it("loadSpeakerTimeline: отфильтровывает мусорные записи", async () => {
    const path = join(dir, "m1.speakers.json");
    await writeFile(
      path,
      JSON.stringify([
        { atMs: 0, name: "Аня" },
        { atMs: "не число", name: "Боря" },
        { name: "без atMs" },
        { atMs: 100, name: "" },
      ]),
    );
    expect(loadSpeakerTimeline(path)).toEqual([{ atMs: 0, name: "Аня" }]);
  });

  it("loadTrimOffsetMs: нет файла -> 0", () => {
    expect(loadTrimOffsetMs(join(dir, "m1.wav"))).toBe(0);
  });

  it("applySpeakerTimeline сдвигает таймлайн на смещение после срезки тишины", async () => {
    const audioPath = join(dir, "m1.speech.wav");
    await writeFile(
      join(dir, "m1.speakers.json"),
      JSON.stringify([
        { atMs: 5000, name: "Аня" },
        { atMs: 8000, name: "Боря" },
      ]),
    );
    await writeFile(
      join(dir, "m1.trim-offset.json"),
      JSON.stringify({ startMs: 5000 }),
    );
    // После сдвига на 5000: Аня с 0, Боря с 3000. Сегмент 3200-4000 -> Боря
    const result = applySpeakerTimeline([segment(3200, 4000)], audioPath);
    expect(result[0].speaker).toBe("Боря");
  });

  it("applySpeakerTimeline без таймлайна возвращает вход как есть", () => {
    const audioPath = join(dir, "m1.speech.wav");
    const segments = [segment(0, 100)];
    expect(applySpeakerTimeline(segments, audioPath)).toBe(segments);
  });
});
