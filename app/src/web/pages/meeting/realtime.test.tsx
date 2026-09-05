import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../../../server/app.ts";
import { authHeaders, setupAuthedDb } from "../../../server/test-auth.ts";
import type { MeetingDetail } from "../../../shared/types.ts";
import { MeetingView } from "./MeetingView.tsx";

describe("realtime транскрипт", () => {
  let db: ReturnType<typeof setupAuthedDb>["db"];
  let auth: ReturnType<typeof setupAuthedDb>["auth"];

  afterEach(() => {
    db?.close();
  });

  it("GET transcribing отдаёт сегмент, UI показывает заглушку realtime", async () => {
    ({ db, auth } = setupAuthedDb());
    const meeting = db.createMeeting({
      url: "https://zoom.us/j/1",
      platform: "zoom",
    });
    db.updateMeetingStatus(meeting.id, "transcribing");
    db.saveTranscript(meeting.id, [
      {
        speaker: "Анна Петрова",
        startedAtMs: 0,
        endedAtMs: 4000,
        text: "Начинаем standup по пилоту",
      },
    ]);

    const res = await app.request(`/api/meetings/${meeting.id}`, {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeetingDetail;
    expect(body.meeting.status).toBe("transcribing");
    expect(body.transcript.some((seg) => seg.text.includes("standup"))).toBe(
      true,
    );
    expect(body.realtime?.caption).toBe("заглушка realtime");

    const html = renderToString(
      <MemoryRouter>
        <MeetingView detail={body} trackerLabel="ClickUp" />
      </MemoryRouter>,
    );
    expect(html).toContain("Начинаем standup по пилоту");
    expect(html).toContain("заглушка realtime");
  });
});
