import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TRACKER_LABELS } from "../../../shared/types.ts";
import type { MeetingDetail, Project, Settings } from "../../../shared/types.ts";
import { MeetingView } from "./MeetingView.tsx";
import "./meeting.css";

export function MeetingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [trackerLabel, setTrackerLabel] = useState("ClickUp");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [epicKey, setEpicKey] = useState<string | null>(null);
  const [trackerNotice, setTrackerNotice] = useState<string | null>(null);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectChangeBusy, setProjectChangeBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const applyProjectMeta = useCallback(
    (projectId: string | null | undefined, list: Project[]) => {
      if (!projectId) {
        setProjectName(null);
        setEpicKey(null);
        return;
      }
      const project = list.find((item) => item.id === projectId);
      setProjectName(project?.name ?? null);
      setEpicKey(project?.trackerParentRef || null);
    },
    [],
  );

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
    const projectsRes = await fetch("/api/projects");
    if (projectsRes.ok) {
      const projectsBody = (await projectsRes.json()) as {
        projects: Project[];
      };
      const list = projectsBody.projects ?? [];
      setProjects(list);
      applyProjectMeta(body.meeting.projectId, list);
    } else {
      applyProjectMeta(body.meeting.projectId, projects);
    }
  }, [applyProjectMeta, projects]);

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

  const onCreateTasks = async (ids: string[]) => {
    if (!id || ids.length === 0) {
      return;
    }
    const res = await fetch(`/api/meetings/${id}/tracker-create-tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
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
    if (!id || !detail || detail.transcript.length === 0) {
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
      let message = "Не удалось получить ответ. Попробуйте позже.";
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody.error?.trim()) {
          message = errBody.error.trim();
        }
      } catch {
        // тело ответа не JSON
      }
      setAskAnswer(message);
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

  const onDelete = async () => {
    if (!id) {
      return;
    }
    setDeleteBusy(true);
    const res = await fetch(`/api/meetings/${id}`, { method: "DELETE" });
    setDeleteBusy(false);
    if (res.ok) {
      navigate("/");
    }
  };

  const onGenerate = async () => {
    if (!id) {
      return;
    }
    setGenerateBusy(true);
    const res = await fetch(`/api/meetings/${id}/summarize`, { method: "POST" });
    if (res.ok) {
      await load(id);
    }
    setGenerateBusy(false);
  };

  const onSaveTitle = async (title: string) => {
    if (!id) {
      return;
    }
    const res = await fetch(`/api/meetings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      return;
    }
    const body = (await res.json()) as Pick<MeetingDetail, "meeting">;
    setDetail((prev) =>
      prev ? { ...prev, meeting: body.meeting } : prev,
    );
  };

  const onChangeProject = async (projectId: string) => {
    if (!id) {
      return;
    }
    setProjectChangeBusy(true);
    const res = await fetch(`/api/meetings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    setProjectChangeBusy(false);
    if (!res.ok) {
      return;
    }
    const body = (await res.json()) as Pick<MeetingDetail, "meeting">;
    setDetail((prev) =>
      prev ? { ...prev, meeting: body.meeting } : prev,
    );
    applyProjectMeta(body.meeting.projectId, projects);
  };

  const onSaveSegment = async (
    segmentId: string,
    text: string,
    dropSegmentIds?: string[],
  ) => {
    if (!id) {
      return;
    }
    const res = await fetch(`/api/meetings/${id}/transcript`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        segmentId,
        text,
        dropSegmentIds: dropSegmentIds ?? [],
      }),
    });
    if (!res.ok) {
      return;
    }
    const body = (await res.json()) as Pick<MeetingDetail, "transcript">;
    setDetail((prev) =>
      prev ? { ...prev, transcript: body.transcript } : prev,
    );
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
      projectId={detail.meeting.projectId ?? null}
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
      }))}
      epicKey={epicKey}
      trackerLabel={trackerLabel}
      trackerNotice={trackerNotice}
      onCreateTasks={(ids) => void onCreateTasks(ids)}
      onAsk={(question) => void onAsk(question)}
      askAnswer={askAnswer}
      askBusy={askBusy}
      onRetry={() => void onRetry()}
      onDelete={() => void onDelete()}
      onSaveTitle={(title) => onSaveTitle(title)}
      onChangeProject={(projectId) => onChangeProject(projectId)}
      onGenerate={() => void onGenerate()}
      onSaveSegment={(segmentId, text) => onSaveSegment(segmentId, text)}
      generateBusy={generateBusy}
      deleteBusy={deleteBusy}
      projectChangeBusy={projectChangeBusy}
    />
  );
}
