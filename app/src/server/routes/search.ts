import { Hono } from "hono";
import { getDb } from "../../db/index.ts";
import type { Db } from "../../db/index.ts";
import type { Meeting, MeetingStatus, Platform } from "../../shared/types.ts";
import type { AppEnv } from "../app-env.ts";

export const searchRouter = new Hono<AppEnv>();

function excerpt(text: string, query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.toLowerCase())
    .filter(Boolean);
  const needle = terms.find((term) => text.toLowerCase().includes(term)) ?? "";
  if (!needle) {
    return text.slice(0, 180);
  }
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) {
    return text.slice(0, 180);
  }
  const start = Math.max(0, idx - 48);
  const end = Math.min(text.length, idx + needle.length + 80);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function matchingExcerpt(texts: string[], query: string): string | null {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) {
    return null;
  }
  const hit = texts.find((text) => {
    const lower = text.toLowerCase();
    return terms.some((term) => lower.includes(term));
  });
  return hit ? excerpt(hit, query) : null;
}

function buildSnippet(db: Db, meeting: Meeting, query: string): string {
  if (!query.trim()) {
    const summary = db.getSummary(meeting.id);
    const headline = summary?.headline?.trim();
    if (headline) {
      return headline.slice(0, 180);
    }
    return meeting.title ?? "";
  }
  const summary = db.getSummary(meeting.id);
  const fromField = matchingExcerpt(
    [
      ...db.listTranscript(meeting.id).map((segment) => segment.text),
      summary?.headline ?? "",
      summary?.decisions ?? "",
      summary?.risks ?? "",
      summary?.nextStep ?? "",
      ...db.listActionItems(meeting.id).map((item) => item.title),
      meeting.title ?? "",
    ],
    query,
  );
  return fromField ?? "совпадение в расшифровке или резюме";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function inPeriod(meeting: Meeting, period: string | undefined, now: Date): boolean {
  if (!period) {
    return true;
  }
  if (!meeting.startedAt) {
    return false;
  }
  const started = new Date(meeting.startedAt);
  if (Number.isNaN(started.getTime())) {
    return false;
  }
  if (period === "7d") {
    return now.getTime() - started.getTime() <= 7 * DAY_MS && started.getTime() <= now.getTime();
  }
  if (period === "month") {
    return (
      started.getFullYear() === now.getFullYear() &&
      started.getMonth() === now.getMonth()
    );
  }
  if (period === "quarter") {
    const sameYear = started.getFullYear() === now.getFullYear();
    const sameQuarter =
      Math.floor(started.getMonth() / 3) === Math.floor(now.getMonth() / 3);
    return sameYear && sameQuarter;
  }
  return true;
}

function isMeetingStatus(value: string): value is MeetingStatus {
  return (
    value === "queued" ||
    value === "joining" ||
    value === "recording" ||
    value === "transcribing" ||
    value === "summarizing" ||
    value === "ready" ||
    value === "error"
  );
}

searchRouter.get("/", (c) => {
  const q = c.req.query("q") ?? "";
  const platform = c.req.query("platform") as Platform | undefined;
  const period = c.req.query("period");
  const statusParam = c.req.query("status");
  const status =
    statusParam && isMeetingStatus(statusParam)
      ? (statusParam as MeetingStatus)
      : undefined;
  const projectId = c.req.query("projectId");
  const db = getDb();
  const userId = c.get("userId");
  let meetings: Meeting[];
  try {
    meetings = db.searchMeetings(q, platform ? { platform } : {});
  } catch {
    return c.json(
      { error: "некорректный поисковый запрос", results: [] },
      400,
    );
  }
  meetings = meetings.filter((meeting) => {
    if (meeting.ownerUserId && meeting.ownerUserId !== userId) {
      return false;
    }
    return inPeriod(meeting, period, new Date());
  });
  if (status) {
    meetings = meetings.filter((meeting) => meeting.status === status);
  }
  if (projectId) {
    meetings = meetings.filter((meeting) => meeting.projectId === projectId);
  }
  const projects = new Map(
    db.listProjects().map((project) => [project.id, project]),
  );
  return c.json({
    results: meetings.map((meeting) => {
      const project =
        meeting.projectId ? projects.get(meeting.projectId) : undefined;
      return {
        id: meeting.id,
        title: meeting.title,
        platform: meeting.platform,
        status: meeting.status,
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        projectId: meeting.projectId,
        projectName: project?.name ?? null,
        epicKey: project?.trackerParentRef || null,
        snippet: buildSnippet(db, meeting, q),
        href: `/meetings/${meeting.id}`,
      };
    }),
  });
});
