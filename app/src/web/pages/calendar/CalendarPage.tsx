import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CalendarEvent, CalendarFeed, Meeting } from "../../../shared/types.ts";
import { CalendarView } from "./CalendarView.tsx";

const PROJECT_STORAGE_KEY = "pm-assistant:selectedProjectId";

type MeetingsResponse = {
  meetings: Meeting[];
};

type ProjectsSummaryResponse = {
  projects: { id: string }[];
};

type CreateMeetingResponse = {
  meeting?: Meeting;
  error?: string;
};

function readStoredProjectId(): string | null {
  try {
    return localStorage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function CalendarPage() {
  const navigate = useNavigate();
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingEventId, setSendingEventId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/calendar/events").then(
        (res) => res.json() as Promise<CalendarFeed>,
      ),
      fetch("/api/meetings").then(
        (res) => res.json() as Promise<MeetingsResponse>,
      ),
      fetch("/api/projects/summary").then(
        (res) => res.json() as Promise<ProjectsSummaryResponse>,
      ),
    ])
      .then(([feedBody, meetingsBody, projectsBody]) => {
        const stored = readStoredProjectId();
        const projects = projectsBody.projects;
        const resolved =
          (stored && projects.some((project) => project.id === stored)
            ? stored
            : null) ??
          projects[0]?.id ??
          null;
        setFeed(feedBody);
        setMeetings(meetingsBody.meetings);
        setProjectId(resolved);
        setError(null);
      })
      .catch(() => {
        setError("Не удалось загрузить календарь");
      });
  }, []);

  async function onSendBot(event: CalendarEvent): Promise<void> {
    if (!projectId) {
      setError("выберите проект");
      return;
    }
    setSendingEventId(event.id);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: event.url, projectId, title: event.title }),
      });
      const body = (await res.json()) as CreateMeetingResponse;
      if (!res.ok || !body.meeting) {
        setError(body.error ?? "Не удалось отправить бота");
        return;
      }
      setError(null);
      navigate(`/meetings/${body.meeting.id}`);
    } catch {
      setError("Не удалось отправить бота");
    } finally {
      setSendingEventId(null);
    }
  }

  if (feed === null) {
    return (
      <section className="calendar">
        <h1 className="calendar__title">{error ?? "Загрузка календаря..."}</h1>
      </section>
    );
  }

  return (
    <>
      {error ? <p className="calendar__error">{error}</p> : null}
      <CalendarView
        feed={feed}
        meetings={meetings}
        onSendBot={onSendBot}
        sendingEventId={sendingEventId}
      />
    </>
  );
}
