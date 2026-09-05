import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { TRACKER_LABELS } from "../../../shared/types.ts";
import type { MeetingDetail, Project, Settings } from "../../../shared/types.ts";
import { MeetingView } from "./MeetingView.tsx";
import "./meeting.css";

export function MeetingPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [trackerLabel, setTrackerLabel] = useState("ClickUp");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [epicKey, setEpicKey] = useState<string | null>(null);
  const [trackerNotice, setTrackerNotice] = useState<string | null>(null);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (meetingId: string) => {
    const res = await fetch(`/api/meetings/${meetingId}`);
    if (res.status === 404) {
      setDetail(null);
      setLoadError("Встреча не найдена");
      return;
    }
    if (!res.ok) {
      setLoadError("Не удалось загрузить встречу");
      return;
    }
    setLoadError(null);
    const body = (await res.json()) as MeetingDetail;
    setDetail(body);
    const projectId = body.meeting.projectId;
    if (projectId) {
      const projectsRes = await fetch("/api/projects");
      if (projectsRes.ok) {
        const projectsBody = (await projectsRes.json()) as {
          projects: Project[];
        };
        const project = projectsBody.projects.find((item) => item.id === projectId);
        setProjectName(project?.name ?? null);
        setEpicKey(project?.trackerParentRef || null);
      }
    } else {
      setProjectName(null);
      setEpicKey(null);
    }
  }, []);

  useEffect(() => {
    if (!id) {
      setLoadError("Встреча не найдена");
      return;
    }
    void load(id);
  }, [id, load]);

  useEffect(() => {
    if (!id || !detail) {
      return;
    }
    const status = detail.meeting.status;
    if (status === "ready" || status === "error") {
      return;
    }
    const timer = window.setInterval(() => {
      void load(id);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [id, detail, load]);

  useEffect(() => {
    void fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((settings: Settings | null) => {
        if (settings) {
          setTrackerLabel(TRACKER_LABELS[settings.trackerType]);
        }
      });
  }, []);

  const onCreateTasks = async () => {
    if (!id) {
      return;
    }
    const res = await fetch(`/api/meetings/${id}/tracker-create-tasks`, {
      method: "POST",
    });
    if (!res.ok) {
      return;
    }
    const body = (await res.json()) as Pick<MeetingDetail, "actionItems"> & {
      tracker?: { notice?: string };
    };
    setDetail((prev) =>
      prev ? { ...prev, actionItems: body.actionItems } : prev,
    );
    setTrackerNotice(body.tracker?.notice ?? null);
  };

  const onAsk = async (question: string) => {
    if (!id) {
      return;
    }
    setAskBusy(true);
    setAskAnswer(null);
    const res = await fetch(`/api/meetings/${id}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    setAskBusy(false);
    if (!res.ok) {
      setAskAnswer("Не удалось получить ответ. Попробуйте позже.");
      return;
    }
    const body = (await res.json()) as { answer?: string };
    setAskAnswer(body.answer ?? "Ответ пока не готов.");
  };

  const onRetry = async () => {
    if (!id || !detail) {
      return;
    }
    const path = detail.meeting.audioPath
      ? `/api/meetings/${id}/transcribe`
      : `/api/meetings/${id}/retry`;
    const res = await fetch(path, { method: "POST" });
    if (res.ok) {
      await load(id);
    }
  };

  if (loadError && !detail) {
    return (
      <section className="meeting">
        <h1 className="meeting__title">{loadError}</h1>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="meeting">
        <p className="meeting__muted">Загрузка итогов встречи...</p>
      </section>
    );
  }

  return (
    <MeetingView
      detail={detail}
      projectName={projectName}
      epicKey={epicKey}
      trackerLabel={trackerLabel}
      trackerNotice={trackerNotice}
      onCreateTasks={() => void onCreateTasks()}
      onAsk={(question) => void onAsk(question)}
      askAnswer={askAnswer}
      askBusy={askBusy}
      onRetry={() => void onRetry()}
    />
  );
}
