import { FormEvent, useEffect, useState } from "react";
import type { CalendarEvent, CalendarFeed, Meeting } from "../../../shared/types.ts";
import { HomeView, type HomeProject, type StorageStats } from "./HomeView.tsx";

const PROJECT_STORAGE_KEY = "pm-assistant:selectedProjectId";

type MeetingsResponse = {
  meetings: Meeting[];
  storage: StorageStats;
};

type ProjectsSummaryResponse = {
  projectCount: number;
  meetingCount: number;
  projects: HomeProject[];
};

type CreateMeetingResponse = {
  meeting?: Meeting;
  alreadyRunning?: boolean;
  error?: string;
};

function readStoredProjectId(): string | null {
  try {
    return localStorage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeProjectId(projectId: string): void {
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
  } catch {
    // localStorage может быть недоступен в тестах
  }
}

export function Home() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [storage, setStorage] = useState<StorageStats>({
    meetingCount: 0,
    usedBytes: 0,
  });
  const [projects, setProjects] = useState<HomeProject[]>([]);
  const [projectCount, setProjectCount] = useState(0);
  const [meetingCount, setMeetingCount] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState(
    readStoredProjectId() ?? "",
  );
  const [upcomingCalendarEvents, setUpcomingCalendarEvents] = useState<
    CalendarEvent[]
  >([]);

  async function loadMeetings(): Promise<void> {
    const res = await fetch("/api/meetings");
    if (!res.ok) {
      throw new Error("не удалось загрузить встречи");
    }
    const body = (await res.json()) as MeetingsResponse;
    setMeetings(body.meetings);
    setStorage(body.storage);
  }

  async function loadProjectsSummary(): Promise<void> {
    const res = await fetch("/api/projects/summary");
    if (!res.ok) {
      throw new Error("не удалось загрузить проекты");
    }
    const body = (await res.json()) as ProjectsSummaryResponse;
    setProjects(body.projects);
    setProjectCount(body.projectCount);
    setMeetingCount(body.meetingCount);
    setSelectedProjectId((current) => {
      if (current && body.projects.some((project) => project.id === current)) {
        return current;
      }
      const stored = readStoredProjectId();
      if (stored && body.projects.some((project) => project.id === stored)) {
        return stored;
      }
      return body.projects[0]?.id ?? "";
    });
  }

  async function loadAll(): Promise<void> {
    await Promise.all([loadMeetings(), loadProjectsSummary()]);
    setError(null);
  }

  async function loadCalendar(): Promise<void> {
    const res = await fetch("/api/calendar/events");
    if (!res.ok) {
      return;
    }
    const body = (await res.json()) as CalendarFeed;
    setUpcomingCalendarEvents(body.events.slice(0, 3));
  }

  useEffect(() => {
    void loadAll().catch(() => {
      setError("Не удалось загрузить главную");
    });
    void loadCalendar().catch(() => undefined);
    const timer = window.setInterval(() => {
      void loadMeetings().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  async function postMeeting(
    targetUrl: string,
    projectId?: string | null,
  ): Promise<void> {
    const resolvedProjectId = projectId || selectedProjectId;
    if (!resolvedProjectId) {
      setError("выберите проект");
      return;
    }
    setNotice(null);
    setBusy(true);
    const submitted = targetUrl;
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: targetUrl, projectId: resolvedProjectId }),
      });
      const body = (await res.json()) as CreateMeetingResponse;
      if (!res.ok) {
        setError(body.error ?? "Не удалось отправить бота");
        setUrl(submitted);
        return;
      }
      storeProjectId(resolvedProjectId);
      setError(null);
      setUrl("");
      setNotice(body.alreadyRunning ? "Уже запущено" : null);
      await loadAll();
    } catch {
      setError("Не удалось отправить бота");
      setUrl(submitted);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await postMeeting(url);
  }

  function onProjectChange(projectId: string): void {
    setSelectedProjectId(projectId);
    storeProjectId(projectId);
  }

  return (
    <HomeView
      meetings={meetings}
      storage={storage}
      projects={projects}
      projectCount={projectCount}
      meetingCount={meetingCount}
      selectedProjectId={selectedProjectId}
      url={url}
      error={error}
      notice={notice}
      busy={busy}
      upcomingCalendarEvents={upcomingCalendarEvents}
      onUrlChange={setUrl}
      onProjectChange={onProjectChange}
      onSubmit={onSubmit}
      onSendBot={(meetingUrl, projectId) => {
        void postMeeting(meetingUrl, projectId);
      }}
    />
  );
}
