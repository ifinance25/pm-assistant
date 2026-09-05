import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, setDb } from "../db/index.ts";
import { app } from "./app.ts";
import { authHeaders, seedTestAuth, setupAuthedDb } from "./test-auth.ts";

describe("GET /api/search", () => {
  let db: ReturnType<typeof createDb>;
  let auth: ReturnType<typeof seedTestAuth>;

  afterEach(() => {
    db?.close();
  });

  function searchRequest(path: string) {
    return app.request(path, { headers: authHeaders(auth) });
  }

  it("находит по префиксу слова в транскрипте", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/prefix-fixture",
      platform: "zoom",
      title: "Планирование спринта",
    });
    db.saveTranscript(meeting.id, [
      {
        speaker: "Анна",
        startedAtMs: 0,
        endedAtMs: 4000,
        text: "Сегодня разберём статус по релизам",
      },
    ]);

    const res = await searchRequest("/api/search?q=релиз");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string }[] };
    expect(body.results.map((row) => row.id)).toContain(meeting.id);
  });

  it("находит по названию встречи", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/title-search",
      platform: "zoom",
      title: "Синк по roadmap Q4",
    });

    const res = await searchRequest(
      "/api/search?q=" + encodeURIComponent("Синк"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string }[] };
    expect(body.results.map((row) => row.id)).toContain(meeting.id);
  });

  it("находит текст из транскрипта и из резюме", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/search-fixture",
      platform: "zoom",
      title: "Планирование спринта",
    });
    db.saveTranscript(meeting.id, [
      {
        speaker: "Анна",
        startedAtMs: 0,
        endedAtMs: 4000,
        text: "Нужно обсудить квантовыйборщ до пятницы",
      },
    ]);
    db.saveSummary(meeting.id, {
      headline: "Решение: лунныйкалендарь утверждён",
      decisions: "Утвердить лунныйкалендарь",
      risks: "",
      nextStep: "",
    });

    const fromTranscript = await searchRequest(
      "/api/search?q=квантовыйборщ",
    );
    expect(fromTranscript.status).toBe(200);
    const transcriptBody = (await fromTranscript.json()) as {
      results: { id: string }[];
    };
    expect(transcriptBody.results.map((r) => r.id)).toContain(meeting.id);

    const fromSummary = await searchRequest("/api/search?q=лунныйкалендарь");
    expect(fromSummary.status).toBe(200);
    const summaryBody = (await fromSummary.json()) as {
      results: { id: string }[];
    };
    expect(summaryBody.results.map((r) => r.id)).toContain(meeting.id);
  });

  it("фильтр platform сужает выдачу", async () => {
    ({ db, auth } = setupAuthedDb());
    const zoom = db.createMeeting({
      url: "https://zoom.us/j/zoom-hit",
      platform: "zoom",
      title: "Zoom сиропныймаятник",
    });
    db.createMeeting({
      url: "https://meet.google.com/abc-defg-hij",
      platform: "meet",
      title: "Meet сиропныймаятник",
    });

    const res = await searchRequest(
      "/api/search?q=сиропныймаятник&platform=zoom",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string }[] };
    expect(body.results.map((r) => r.id)).toEqual([zoom.id]);
  });

  it("фильтр period сужает выдачу", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-search-"));
    const dbPath = join(dir, "app.sqlite");
    db = createDb(dbPath);
    setDb(db);
    auth = seedTestAuth(db);

    const recent = db.createMeeting({
      url: "https://zoom.us/j/recent",
      platform: "zoom",
      title: "недавняя вехатормоз",
    });
    const old = db.createMeeting({
      url: "https://zoom.us/j/old",
      platform: "zoom",
      title: "старая вехатормоз",
    });

    const sqlite = new Database(dbPath);
    const now = Date.now();
    sqlite
      .prepare("UPDATE meetings SET started_at = ? WHERE id = ?")
      .run(new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(), recent.id);
    sqlite
      .prepare("UPDATE meetings SET started_at = ? WHERE id = ?")
      .run(new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(), old.id);
    sqlite.close();

    const res = await searchRequest("/api/search?q=вехатормоз&period=7d");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string }[] };
    expect(body.results.map((r) => r.id)).toEqual([recent.id]);
  });

  it("отдаёт сниппет с фрагментом и ссылку на встречу", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/snippet",
      platform: "zoom",
      title: "Планирование roadmap Q3",
    });
    db.saveActionItems(meeting.id, [
      {
        assignee: "Денис",
        title: "проверить индексацию Telemost",
        dueAt: null,
        timecodeMs: null,
        segmentId: null,
      },
    ]);

    const res = await searchRequest("/api/search?q=roadmap");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { id: string; snippet: string; href: string }[];
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe(meeting.id);
    expect(body.results[0].href).toBe(`/meetings/${meeting.id}`);
    expect(body.results[0].snippet).toMatch(/roadmap/i);
  });

  it("сниппет содержит фразу из транскрипта или резюме", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/snippet-fields",
      platform: "zoom",
      title: "Планирование спринта",
    });
    db.saveTranscript(meeting.id, [
      {
        speaker: "Анна",
        startedAtMs: 0,
        endedAtMs: 4000,
        text: "Нужно обсудить фиолетовыйкефир до пятницы",
      },
    ]);
    db.saveSummary(meeting.id, {
      headline: "Решение: стеклянныйякорь утверждён",
      decisions: "Утвердить стеклянныйякорь",
      risks: "",
      nextStep: "",
    });

    const fromTranscript = await searchRequest("/api/search?q=фиолетовыйкефир");
    expect(fromTranscript.status).toBe(200);
    const transcriptBody = (await fromTranscript.json()) as {
      results: { snippet: string }[];
    };
    expect(transcriptBody.results[0]?.snippet).toContain("фиолетовыйкефир");

    const fromSummary = await searchRequest("/api/search?q=стеклянныйякорь");
    expect(fromSummary.status).toBe(200);
    const summaryBody = (await fromSummary.json()) as {
      results: { snippet: string }[];
    };
    expect(summaryBody.results[0]?.snippet).toContain("стеклянныйякорь");
  });

  it("при отсутствии совпадений возвращает пустой список", async () => {
    ({ db, auth } = setupAuthedDb());
    db.createMeeting({
      url: "https://zoom.us/j/empty",
      platform: "zoom",
      title: "Обычная встреча",
    });

    const res = await searchRequest("/api/search?q=несуществующаяаббракадабра");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("фильтрует по projectId и возвращает projectName и epicKey", async () => {
    ({ db, auth } = setupAuthedDb());
    const project = db.createProject({
      name: "Roadmap Q4",
      trackerParentRef: "ROAD-100",
    });
    const other = db.createProject({ name: "Свои" });
    const hit = db.createMeeting({
      url: "https://zoom.us/j/hit",
      projectId: project.id,
      title: "Синк Q4",
    });
    db.createMeeting({
      url: "https://zoom.us/j/miss",
      projectId: other.id,
      title: "Другое",
    });

    const res = await searchRequest(
      `/api/search?q=&projectId=${project.id}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: {
        id: string;
        projectName: string | null;
        epicKey: string | null;
      }[];
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe(hit.id);
    expect(body.results[0].projectName).toBe("Roadmap Q4");
    expect(body.results[0].epicKey).toBe("ROAD-100");
  });

  it("без запроса отдаёт список со сниппетом из headline и endedAt", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/headline",
      platform: "zoom",
      title: "Синк по roadmap Q4",
    });
    db.saveSummary(meeting.id, {
      headline: "Интеграции переносим в настройки",
      decisions: "Оставить релиз",
      risks: "",
      nextStep: "",
    });

    const res = await searchRequest("/api/search");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: {
        id: string;
        snippet: string;
        endedAt: string | null;
      }[];
    };
    const row = body.results.find((item) => item.id === meeting.id);
    expect(row?.snippet).toBe("Интеграции переносим в настройки");
    expect(row).toHaveProperty("endedAt");
  });
});
