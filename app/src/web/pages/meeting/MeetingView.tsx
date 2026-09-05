import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  type ActionItem,
  type Meeting,
  type MeetingDetail,
  type MeetingStatus,
  type TrackerState,
  type TranscriptSegment,
  type TranscribeProgress,
  realtimeCaption,
} from "../../../shared/types.ts";
import { REVIEW_SKIPPED_NOTICE } from "../../../adapters/llm/pending.ts";
import {
  frameScrollTopForTarget,
  groupTranscriptSegments,
} from "../../../shared/group-transcript.ts";

const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;

export function formatPlaybackRate(rate: number): string {
  if (rate === Math.trunc(rate)) {
    return `${rate}×`;
  }
  return `${String(rate).replace(".", ",")}×`;
}

export function recordDownloadName(): string {
  return `Record_${Date.now()}`;
}

const STATUS_LABEL: Record<MeetingStatus, string> = {
  queued: "В очереди",
  joining: "Подключение",
  waiting_room: "Зал ожидания",
  recording: "Идёт запись",
  transcribing: "Расшифровка",
  summarizing: "Готовим резюме",
  ready: "Готово",
  error: "Ошибка",
};

export type MeetingProjectOption = {
  id: string;
  name: string;
};

export type MeetingViewProps = {
  detail: MeetingDetail;
  projectName?: string | null;
  projectId?: string | null;
  projects?: MeetingProjectOption[];
  epicKey?: string | null;
  trackerLabel: string;
  trackerNotice?: string | null;
  onCreateTasks?: (ids: string[]) => void;
  onRetry?: () => void;
  onDelete?: () => void | Promise<void>;
  onSaveTitle?: (title: string) => void | Promise<void>;
  onChangeProject?: (projectId: string) => void | Promise<void>;
  onGenerate?: () => void | Promise<void>;
  onSaveSegment?: (
    segmentId: string,
    text: string,
    dropSegmentIds?: string[],
  ) => void | Promise<void>;
  generateBusy?: boolean;
  deleteBusy?: boolean;
  projectChangeBusy?: boolean;
  onAsk?: (question: string) => void;
  askAnswer?: string | null;
  askBusy?: boolean;
  /** @deprecated используйте trackerLabel */
  asanaProjectLabel?: string;
  /** @deprecated */
  asanaNotice?: string | null;
  /** @deprecated */
  onAsanaQueue?: () => void;
};

export function canAskAboutMeeting(transcript: TranscriptSegment[]): boolean {
  return transcript.length > 0;
}

export function formatTimecode(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type TranscriptFilter =
  | "all"
  | "questions"
  | "decisions"
  | "tasks"
  | `speaker:${string}`;

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function formatEtaClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatRemaining(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  if (totalMin < 60) {
    return `${totalMin} мин`;
  }
  const hours = Math.floor(totalMin / 60);
  const rest = totalMin % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

function transcribeProgressLine(
  progress: NonNullable<MeetingViewProps["detail"]["transcribeProgress"]>,
): string {
  const percent = Math.max(0, Math.round(progress.percent));
  if (!progress.etaAt || progress.remainingMs == null) {
    return `${percent}%. Оценка появится после первых фрагментов.`;
  }
  return `${percent}%. Готово примерно в ${formatEtaClock(progress.etaAt)}, осталось ${formatRemaining(progress.remainingMs)}.`;
}

function wallClockDurationLabel(meeting: Meeting): string | null {
  if (!meeting.startedAt || !meeting.endedAt) {
    return null;
  }
  const start = Date.parse(meeting.startedAt);
  const end = Date.parse(meeting.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const minutes = Math.round((end - start) / 60_000);
  return `${minutes} мин`;
}

export function meetingDurationLabel(
  meeting: Meeting,
  transcript: TranscriptSegment[],
  transcribeProgress?: TranscribeProgress | null,
  playerDurationSec = 0,
): string | null {
  if (playerDurationSec > 0) {
    return `${Math.max(1, Math.round(playerDurationSec / 60))} мин`;
  }
  const audioMs = transcribeProgress?.audioDurationMs;
  if (audioMs != null && audioMs > 0) {
    return `${Math.max(1, Math.round(audioMs / 60_000))} мин`;
  }
  if (transcript.length > 0) {
    const lastMs = Math.max(
      ...transcript.map((seg) => seg.endedAtMs ?? seg.startedAtMs),
    );
    if (lastMs > 0) {
      return `${Math.max(1, Math.round(lastMs / 60_000))} мин`;
    }
  }
  return wallClockDurationLabel(meeting);
}

function speakerInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

type DisplaySegment = TranscriptSegment & { sourceIds: string[] };

function toDisplaySegments(segments: TranscriptSegment[]): DisplaySegment[] {
  return groupTranscriptSegments(segments).map((block) => {
    const first = block.parts[0]!;
    return {
      ...first,
      startedAtMs: block.startedAtMs,
      endedAtMs: block.endedAtMs,
      text: block.text,
      sourceIds: block.parts.map((part) => part.id),
    };
  });
}

function matchesTranscriptFilter(
  seg: DisplaySegment,
  filter: TranscriptFilter,
  decisionSegmentIds: string[],
  actionItems: ActionItem[],
): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter.startsWith("speaker:")) {
    return seg.speaker === filter.slice("speaker:".length);
  }
  if (filter === "questions") {
    return seg.text.includes("?");
  }
  if (filter === "decisions") {
    if (decisionSegmentIds.length > 0) {
      return seg.sourceIds.some((id) => decisionSegmentIds.includes(id));
    }
    return false;
  }
  if (filter === "tasks") {
    return actionItems.some(
      (item) =>
        item.segmentId != null && seg.sourceIds.includes(item.segmentId),
    );
  }
  return true;
}

function splitLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
}

function segmentAnchorId(id: string): string {
  return `segment-${id}`;
}

function itemAnchor(item: ActionItem, transcript: DisplaySegment[]): string | null {
  if (item.segmentId) {
    const segmentId = item.segmentId;
    const match = transcript.find((seg) => seg.sourceIds.includes(segmentId));
    return match ? `#${segmentAnchorId(match.id)}` : null;
  }
  if (item.timecodeMs == null) {
    return null;
  }
  const match = transcript.find((seg) => seg.startedAtMs === item.timecodeMs);
  return match ? `#${segmentAnchorId(match.id)}` : null;
}

const TRACKER_STATE_LABEL: Record<TrackerState, string> = {
  none: "не создана",
  queued: "к созданию",
  created: "создана",
};

export function MeetingView({
  detail,
  projectName = null,
  projectId = null,
  projects = [],
  epicKey = null,
  trackerLabel,
  trackerNotice,
  onCreateTasks,
  onRetry,
  onDelete,
  onSaveTitle,
  onChangeProject,
  onGenerate,
  onSaveSegment,
  generateBusy = false,
  deleteBusy = false,
  projectChangeBusy = false,
  onAsk,
  askAnswer = null,
  askBusy = false,
  asanaProjectLabel,
  asanaNotice,
  onAsanaQueue,
}: MeetingViewProps) {
  const resolvedTrackerLabel = trackerLabel || asanaProjectLabel || "трекер";
  const resolvedNotice = trackerNotice ?? asanaNotice ?? null;
  const createTasks = onCreateTasks ?? onAsanaQueue;
  const { meeting, transcript, summary, actionItems } = detail;
  const isRealtime =
    meeting.status === "recording" || meeting.status === "transcribing";
  const caption = detail.realtime?.caption ?? realtimeCaption(meeting.source);
  const showRealtimeCaption =
    meeting.status !== "ready" &&
    (isRealtime || transcript.length > 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState(projectId ?? "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(meeting.title ?? "");
  const [titleSaving, setTitleSaving] = useState(false);
  const canGenerate =
    Boolean(onGenerate) &&
    transcript.length > 0 &&
    (meeting.status === "ready" ||
      meeting.status === "error" ||
      meeting.status === "summarizing");
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [transcriptFilter, setTranscriptFilter] = useState<TranscriptFilter>("all");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() =>
    new Set(
      detail.actionItems
        .filter((item) => item.trackerState === "none")
        .map((item) => item.id),
    ),
  );
  const knownPendingTaskIdsRef = useRef(
    new Set(
      detail.actionItems
        .filter((item) => item.trackerState === "none")
        .map((item) => item.id),
    ),
  );
  const [linkedTaskSegmentId, setLinkedTaskSegmentId] = useState<string | null>(
    null,
  );
  const [playingMs, setPlayingMs] = useState<number | null>(null);
  const [askQuestion, setAskQuestion] = useState("");
  const [askNoTranscriptOpen, setAskNoTranscriptOpen] = useState(false);
  const askReady = canAskAboutMeeting(transcript);
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptFrameRef = useRef<HTMLDivElement>(null);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerDurationSec, setPlayerDurationSec] = useState(0);
  const [playerCurrentSec, setPlayerCurrentSec] = useState(0);
  const [playerMuted, setPlayerMuted] = useState(false);
  const activeMarkRef = useRef<HTMLElement>(null);
  const displayTranscript = useMemo(
    () => toDisplaySegments(transcript),
    [transcript],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [] as { segmentId: string; offset: number }[];
    }
    const found: { segmentId: string; offset: number }[] = [];
    for (const seg of displayTranscript) {
      const lower = seg.text.toLowerCase();
      let from = lower.indexOf(q);
      while (from !== -1) {
        found.push({ segmentId: seg.id, offset: from });
        from = lower.indexOf(q, from + q.length);
      }
    }
    return found;
  }, [displayTranscript, query]);
  const matchCount = matches.length;
  const occStartBySegment = useMemo(() => {
    const map = new Map<string, number>();
    matches.forEach((m, i) => {
      if (!map.has(m.segmentId)) {
        map.set(m.segmentId, i);
      }
    });
    return map;
  }, [matches]);
  const activeSegmentId = matches[activeMatch]?.segmentId ?? null;
  const playingSegmentId = useMemo(() => {
    if (playingMs == null) {
      return null;
    }
    let current: string | null = null;
    for (const seg of displayTranscript) {
      if (seg.startedAtMs <= playingMs) {
        current = seg.id;
      } else {
        break;
      }
    }
    return current;
  }, [displayTranscript, playingMs]);
  const alignInFrame = (target: HTMLElement, behavior: ScrollBehavior) => {
    const frame = transcriptFrameRef.current;
    if (!frame) {
      return;
    }
    const nextTop = frameScrollTopForTarget(
      frame.getBoundingClientRect().top,
      frame.scrollTop,
      target.getBoundingClientRect().top,
    );
    frame.scrollTo({ top: nextTop, behavior });
  };
  useEffect(() => {
    const mark = activeMarkRef.current;
    if (!mark) {
      return;
    }
    const line = mark.closest(".meeting__transcript-line");
    alignInFrame(line instanceof HTMLElement ? line : mark, "smooth");
  }, [activeMatch]);
  useEffect(() => {
    if (query.trim() || playingSegmentId == null) {
      return;
    }
    const frame = transcriptFrameRef.current;
    const line = frame?.querySelector(`#${segmentAnchorId(playingSegmentId)}`);
    if (line instanceof HTMLElement) {
      alignInFrame(line, "auto");
    }
  }, [playingSegmentId, query]);
  const goToMatch = (dir: 1 | -1) => {
    if (matchCount === 0) {
      return;
    }
    setActiveMatch((m) => (m + dir + matchCount) % matchCount);
  };
  const seekTo = (ms: number) => {
    const el = audioRef.current;
    if (!el) {
      return;
    }
    el.currentTime = ms / 1000;
    void el.play().catch(() => undefined);
  };
  const hasAudio = Boolean(meeting.audioPath);
  const queryId = "meeting-search";
  const pending = actionItems.filter((item) => item.trackerState === "none");
  const queued = actionItems.filter((item) => item.trackerState === "queued");
  const created = actionItems.filter((item) => item.trackerState === "created");
  const selectedPending = pending.filter((item) => selectedTaskIds.has(item.id));
  useEffect(() => {
    const pendingIds = pending.map((item) => item.id);
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      for (const id of pendingIds) {
        if (!knownPendingTaskIdsRef.current.has(id)) {
          next.add(id);
          knownPendingTaskIdsRef.current.add(id);
        }
      }
      for (const id of [...next]) {
        if (!pendingIds.includes(id)) {
          next.delete(id);
          knownPendingTaskIdsRef.current.delete(id);
        }
      }
      return next;
    });
  }, [actionItems]);
  const createLabel =
    selectedPending.length > 0
      ? `Создать ${selectedPending.length} ${taskWord(selectedPending.length)} в ${resolvedTrackerLabel}`
      : queued.length > 0
        ? "Задачи к созданию"
        : created.length > 0
          ? `Задачи созданы в ${resolvedTrackerLabel}`
          : "Нет задач для создания";
  const createDisabled = selectedPending.length === 0;
  const datePart = meeting.startedAt ? formatDate(meeting.startedAt) : null;
  const duration = meetingDurationLabel(
    meeting,
    transcript,
    detail.transcribeProgress,
    playerDurationSec,
  );
  const decisions = summary ? splitLines(summary.decisions) : [];
  const decisionSegmentIds = summary?.decisionSegmentIds ?? [];
  const risks = summary ? splitLines(summary.risks) : [];
  const speakers = useMemo(
    () => [...new Set(displayTranscript.map((seg) => seg.speaker))],
    [displayTranscript],
  );
  const filteredTranscript = useMemo(
    () =>
      displayTranscript.filter((seg) =>
        matchesTranscriptFilter(
          seg,
          transcriptFilter,
          decisionSegmentIds,
          actionItems,
        ),
      ),
    [displayTranscript, transcriptFilter, decisionSegmentIds, actionItems],
  );
  const tasksMeta =
    actionItems.length === 0
      ? null
      : `${queued.length + created.length} из ${actionItems.length} к созданию`;
  const handleCreateTasks = () => {
    if (!createTasks || selectedPending.length === 0) {
      return;
    }
    createTasks(selectedPending.map((item) => item.id));
  };
  const focusTaskSegment = (item: ActionItem) => {
    const anchor = itemAnchor(item, displayTranscript);
    if (!anchor) {
      return;
    }
    const segmentId = anchor.slice("#segment-".length);
    setLinkedTaskSegmentId(segmentId);
    const frame = transcriptFrameRef.current;
    const line = frame?.querySelector(`#${segmentAnchorId(segmentId)}`);
    if (line instanceof HTMLElement) {
      alignInFrame(line, "smooth");
    }
  };

  const metaLine = [
    datePart,
    duration,
    meeting.platform === "zoom"
      ? "Zoom"
      : meeting.platform === "meet"
        ? "Google Meet"
        : meeting.platform === "telemost"
          ? "Яндекс Телемост"
          : null,
    epicKey ? `Epic ${epicKey}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    if (!projectPickerOpen) {
      setProjectDraft(projectId ?? "");
    }
  }, [projectId, projectPickerOpen]);

  const resolvedProjectName =
    projectName ??
    projects.find((project) => project.id === projectId)?.name ??
    null;
  const canChangeProject =
    Boolean(onChangeProject) && projects.length > 0 && Boolean(projectId);

  useEffect(() => {
    if (!editingTitle) {
      setTitleDraft(meeting.title ?? "");
    }
  }, [meeting.title, editingTitle]);

  const confirmProjectChange = async () => {
    if (!onChangeProject || !projectDraft || projectDraft === projectId) {
      setProjectPickerOpen(false);
      return;
    }
    await onChangeProject(projectDraft);
    setProjectPickerOpen(false);
  };

  const toggleTitleEdit = async () => {
    if (!onSaveTitle) {
      return;
    }
    if (editingTitle) {
      const next = titleDraft.trim();
      if (!next || next === (meeting.title ?? "").trim()) {
        setEditingTitle(false);
        return;
      }
      setTitleSaving(true);
      try {
        await onSaveTitle(next);
        setEditingTitle(false);
      } finally {
        setTitleSaving(false);
      }
      return;
    }
    setEditingTitle(true);
    setTitleDraft(meeting.title ?? "");
  };

  return (
    <section className="meeting meeting--lock">
      <header className="meeting__header">
        <Link className="meeting__back" to="/">
          <BackIcon />
          Назад
        </Link>
        <div className="meeting__header-body">
          <div className="meeting__title-row">
            <div className="meeting__title-cluster">
              {editingTitle ? (
                <input
                  className="meeting__title-input"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  disabled={titleSaving}
                  aria-label="Название встречи"
                />
              ) : (
                <h1 className="meeting__title">
                  {meeting.title || "Итоги встречи"}
                </h1>
              )}
              {onSaveTitle ? (
                <button
                  type="button"
                  className={
                    editingTitle
                      ? "meeting__title-toggle meeting__title-toggle--save"
                      : "meeting__title-toggle"
                  }
                  onClick={() => void toggleTitleEdit()}
                  disabled={titleSaving}
                  aria-label={editingTitle ? "Сохранить название" : "Править название"}
                  title={editingTitle ? "Сохранить" : "Править"}
                >
                  {editingTitle ? <SaveIcon /> : <PencilIcon />}
                </button>
              ) : null}
              {resolvedProjectName && projectId ? (
                <div className="meeting__project-picker">
                  <button
                    type="button"
                    className="meeting__project-chip"
                    onClick={() => {
                      if (!canChangeProject) {
                        return;
                      }
                      setProjectDraft(projectId);
                      setProjectPickerOpen((open) => !open);
                    }}
                    disabled={!canChangeProject || projectChangeBusy}
                    aria-expanded={projectPickerOpen}
                    aria-haspopup="dialog"
                    title={canChangeProject ? "Сменить проект" : undefined}
                  >
                    <FolderIcon />
                    {resolvedProjectName}
                    {canChangeProject ? <ChevronIcon /> : null}
                  </button>
                  {projectPickerOpen && canChangeProject ? (
                    <div
                      className="meeting__project-menu"
                      role="dialog"
                      aria-label="Смена проекта"
                    >
                      <label
                        className="meeting__project-menu-label"
                        htmlFor="meeting-project-select"
                      >
                        Проект
                      </label>
                      <select
                        id="meeting-project-select"
                        className="meeting__project-select"
                        value={projectDraft}
                        onChange={(event) => setProjectDraft(event.target.value)}
                        disabled={projectChangeBusy}
                      >
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                      <div className="meeting__project-menu-actions">
                        <button
                          type="button"
                          className="meeting__project-menu-cancel"
                          onClick={() => setProjectPickerOpen(false)}
                          disabled={projectChangeBusy}
                        >
                          Отмена
                        </button>
                        <button
                          type="button"
                          className="meeting__project-menu-confirm"
                          onClick={() => void confirmProjectChange()}
                          disabled={
                            projectChangeBusy ||
                            !projectDraft ||
                            projectDraft === projectId
                          }
                        >
                          Подтвердить
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <span
                className={`meeting__badge meeting__badge--${meeting.status}`}
              >
                <span className="meeting__badge-dot" aria-hidden="true" />
                {STATUS_LABEL[meeting.status]}
              </span>
            </div>
            {onDelete ? (
              <button
                type="button"
                className="meeting__delete meeting__delete--icon"
                onClick={() => setConfirmDelete(true)}
                disabled={deleteBusy}
                aria-label="Удалить встречу"
                title="Удалить"
              >
                <TrashIcon />
              </button>
            ) : null}
          </div>
          {metaLine ? <p className="meeting__meta">{metaLine}</p> : null}
        </div>
      </header>

      {meeting.source === "stub" ? (
        <div className="meeting__alert" role="status">
          <p>демо-данные</p>
        </div>
      ) : null}

      {meeting.status === "error" ? (
        <div className="meeting__alert" role="alert">
          <p>{meeting.error ?? "Конвейер остановился с ошибкой."}</p>
          <button type="button" className="meeting__retry" onClick={onRetry}>
            {meeting.audioPath ? "Повторить транскрибацию" : "Повторить"}
          </button>
        </div>
      ) : meeting.status === "ready" &&
        (summary?.risks.includes(REVIEW_SKIPPED_NOTICE) ?? false) ? (
        <p className="meeting__progress">{REVIEW_SKIPPED_NOTICE}</p>
      ) : null}

      {meeting.audioPath ? (
        <MeetingPlayer
          meetingId={meeting.id}
          audioRef={audioRef}
          playing={playerPlaying}
          currentSec={playerCurrentSec}
          durationSec={playerDurationSec}
          muted={playerMuted}
          onPlayingChange={setPlayerPlaying}
          onCurrentSecChange={(sec) => {
            setPlayerCurrentSec(sec);
            setPlayingMs(sec * 1000);
          }}
          onDurationSecChange={setPlayerDurationSec}
          onMutedChange={setPlayerMuted}
        />
      ) : null}

      {meeting.status === "summarizing" || generateBusy ? (
        <p className="meeting__progress meeting__progress--busy" role="status">
          <span className="meeting__progress-spinner" aria-hidden="true" />
          {STATUS_LABEL.summarizing}. Резюме и задачи обновятся через минуту.
        </p>
      ) : isRealtime ? (
        <p className="meeting__progress">
          Сейчас: {STATUS_LABEL[meeting.status]}.
          {detail.transcribeProgress
            ? ` ${transcribeProgressLine(detail.transcribeProgress)}`
            : ""}{" "}
          Сегменты появляются по ходу.
        </p>
      ) : meeting.status !== "ready" && meeting.status !== "error" ? (
        <p className="meeting__progress">
          Сейчас: {STATUS_LABEL[meeting.status]}. Транскрипт и задачи появятся,
          когда обработка закончится.
        </p>
      ) : null}

      <div className="meeting__layout">
        <section className="meeting__main" aria-label="Транскрипт встречи">
          {showRealtimeCaption ? (
            <p className="meeting__realtime">{caption}</p>
          ) : null}
          <div className="meeting__search-row">
            <div className="meeting__search">
              <SearchIcon />
              <input
                id={queryId}
                type="search"
                aria-label="Поиск по расшифровке"
                placeholder="Поиск по словам и спикерам"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveMatch(0);
                }}
              />
              {query.trim() ? (
                <span className="meeting__search-count">
                  {matchCount > 0
                    ? `${activeMatch + 1} / ${matchCount}`
                    : "нет совпадений"}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="meeting__search-nav"
              onClick={() => goToMatch(-1)}
              disabled={matchCount === 0}
              aria-label="Предыдущее совпадение"
            >
              <ChevronUpIcon />
            </button>
            <button
              type="button"
              className="meeting__search-nav"
              onClick={() => goToMatch(1)}
              disabled={matchCount === 0}
              aria-label="Следующее совпадение"
            >
              <ChevronDownIcon />
            </button>
          </div>
          <div className="meeting__filters" role="toolbar" aria-label="Фильтры">
            <button
              type="button"
              className={
                transcriptFilter === "all"
                  ? "meeting__filter meeting__filter--active"
                  : "meeting__filter"
              }
              onClick={() => setTranscriptFilter("all")}
            >
              Все
            </button>
            {speakers.map((speaker) => {
              const id = `speaker:${speaker}` as TranscriptFilter;
              return (
                <button
                  key={speaker}
                  type="button"
                  className={
                    transcriptFilter === id
                      ? "meeting__filter meeting__filter--active"
                      : "meeting__filter"
                  }
                  onClick={() => setTranscriptFilter(id)}
                >
                  {speaker}
                </button>
              );
            })}
            <span className="meeting__filter-divider" aria-hidden="true" />
            {(
              [
                ["questions", "Вопросы"],
                ["decisions", "Решения"],
                ["tasks", "Задачи"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={
                  transcriptFilter === id
                    ? "meeting__filter meeting__filter--active"
                    : "meeting__filter"
                }
                onClick={() => setTranscriptFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="meeting__transcript-frame" ref={transcriptFrameRef}>
            <TranscriptList
              transcript={filteredTranscript}
              query={query}
              activeMatch={activeMatch}
              occStartBySegment={occStartBySegment}
              activeSegmentId={activeSegmentId}
              playingSegmentId={playingSegmentId}
              linkedTaskSegmentId={linkedTaskSegmentId}
              activeMarkRef={activeMarkRef}
              onSeek={hasAudio ? seekTo : undefined}
              onSaveSegment={onSaveSegment}
            />
          </div>
        </section>

        <aside className="meeting__side" aria-label="Обзор и задачи">
          <section className="meeting__overview">
            <div className="meeting__overview-head">
              <h2 className="meeting__overview-title">Обзор</h2>
              {canGenerate ? (
                <button
                  type="button"
                  className="meeting__generate"
                  onClick={() => void onGenerate?.()}
                  disabled={generateBusy || meeting.status === "summarizing"}
                >
                  <SparklesIcon />
                  Сгенерировать
                </button>
              ) : null}
            </div>
            <div className="meeting__counts">
              <CountPill value={displayTranscript.length} label="фрагмента" />
              <CountPill value={decisions.length} label="решения" />
              <CountPill value={actionItems.length} label="задачи" />
            </div>
            <p className="meeting__headline">
              {summary?.headline || "Резюме ещё не готово."}
            </p>
            <SummaryBlock title="Решения" dotClass="meeting__dot--decision">
              {decisions.length > 0 ? (
                <ul className="meeting__bullet-list">
                  {decisions.map((line) => (
                    <li key={line}>
                      <span
                        className="meeting__dot meeting__dot--decision"
                        aria-hidden="true"
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meeting__muted">Пока нет.</p>
              )}
            </SummaryBlock>
            <SummaryBlock title="Риски" dotClass="meeting__dot--risk">
              {risks.length > 0 ? (
                <ul className="meeting__bullet-list">
                  {risks.map((line) => (
                    <li key={line}>
                      <span
                        className="meeting__dot meeting__dot--risk"
                        aria-hidden="true"
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meeting__muted">Пока нет.</p>
              )}
            </SummaryBlock>
            <SummaryBlock title="Следующий шаг" dotClass="meeting__dot--next">
              {summary?.nextStep ? (
                <p className="meeting__bullet-item">
                  <span
                    className="meeting__dot meeting__dot--next"
                    aria-hidden="true"
                  />
                  {summary.nextStep}
                </p>
              ) : (
                <p className="meeting__muted">Пока нет.</p>
              )}
            </SummaryBlock>
          </section>

          <section className="meeting__tasks-card" aria-labelledby="tasks-heading">
            <div className="meeting__tasks-head">
              <h2 id="tasks-heading" className="meeting__tasks-title">
                Задачи встречи
              </h2>
              {tasksMeta ? (
                <span className="meeting__tasks-meta">{tasksMeta}</span>
              ) : null}
            </div>
            <ul className="meeting__tasks">
              {actionItems.map((item) => {
                const href = itemAnchor(item, displayTranscript);
                const selectable = item.trackerState === "none";
                const checked = selectedTaskIds.has(item.id);
                const linkable = Boolean(href);
                const rowClass = [
                  "meeting__task",
                  linkable ? "meeting__task--linkable" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={item.id} className={rowClass}>
                    {selectable ? (
                      <input
                        type="checkbox"
                        className="meeting__task-check"
                        checked={checked}
                        onChange={() => {
                          setSelectedTaskIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) {
                              next.delete(item.id);
                            } else {
                              next.add(item.id);
                            }
                            return next;
                          });
                        }}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Включить задачу: ${item.title}`}
                      />
                    ) : (
                      <span className="meeting__task-check-spacer" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="meeting__task-main"
                      disabled={!linkable}
                      onClick={() => focusTaskSegment(item)}
                    >
                      <span className="meeting__task-avatar" aria-hidden="true">
                        {speakerInitial(item.assignee ?? "?")}
                      </span>
                      <div className="meeting__task-body">
                        <p className="meeting__task-title">{item.title}</p>
                        <div className="meeting__task-meta">
                          {item.timecodeMs != null ? (
                            <span className="meeting__task-time">
                              {formatTimecode(item.timecodeMs)}
                            </span>
                          ) : null}
                          <span
                            className={`meeting__task-state meeting__task-state--${item.trackerState}`}
                          >
                            {TRACKER_STATE_LABEL[item.trackerState]}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="meeting__tracker"
              disabled={createDisabled}
              onClick={handleCreateTasks}
            >
              {createLabel}
            </button>
            <p className="meeting__tracker-hint">
              {`На следующем этапе задача уйдёт в этот Epic. Сейчас только пометка на встрече.`}
            </p>
            {resolvedNotice ? (
              <p className="meeting__tracker-notice">{resolvedNotice}</p>
            ) : null}
          </section>

          <form
            className="meeting__ask"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = askQuestion.trim();
              if (!trimmed || !onAsk) {
                return;
              }
              if (!askReady) {
                setAskNoTranscriptOpen(true);
                return;
              }
              onAsk(trimmed);
            }}
          >
            <div className="meeting__ask-field">
              <AskIcon />
              <input
                id="meeting-ask"
                type="text"
                placeholder="Спросить по этой встрече"
                value={askQuestion}
                onChange={(event) => setAskQuestion(event.target.value)}
                disabled={askBusy}
                aria-label="Спросить по этой встрече"
              />
              <button
                type="submit"
                className="meeting__ask-send"
                disabled={askBusy}
                aria-label="Задать вопрос"
              >
                <SendIcon />
              </button>
            </div>
            <div className="meeting__ask-chips">
              {["Какие решения?", "Что в Epic?"].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="meeting__ask-chip"
                  onClick={() => setAskQuestion(chip)}
                  disabled={askBusy}
                >
                  {chip}
                </button>
              ))}
            </div>
            {askAnswer ? (
              <div className="meeting__ask-answer">
                {askQuestion.trim() ? (
                  <p className="meeting__ask-question">{askQuestion.trim()}</p>
                ) : null}
                <p>{askAnswer}</p>
              </div>
            ) : null}
          </form>
        </aside>
      </div>
      {confirmDelete ? (
        <div className="meeting__dialog-backdrop">
          <div
            className="meeting__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-delete-title"
          >
            <h2 id="meeting-delete-title">Удалить встречу?</h2>
            <p>
              Запись встречи и файл звука будут удалены из базы. Это действие
              нельзя отменить.
            </p>
            <div className="meeting__dialog-actions">
              <button
                type="button"
                className="meeting__dialog-no"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteBusy}
              >
                Отмена
              </button>
              <button
                type="button"
                className="meeting__dialog-yes"
                disabled={deleteBusy}
                onClick={() => {
                  void Promise.resolve(onDelete?.()).finally(() => {
                    setConfirmDelete(false);
                  });
                }}
              >
                <TrashIcon />
                Удалить
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {askNoTranscriptOpen ? (
        <div className="meeting__dialog-backdrop">
          <div
            className="meeting__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-ask-no-transcript-title"
          >
            <h2 id="meeting-ask-no-transcript-title">
              Расшифровка ещё не готова
            </h2>
            <p>
              Вопрос по встрече можно задать только после появления текста
              расшифровки. Дождитесь статуса «Готово» или запустите расшифровку
              заново.
            </p>
            <div className="meeting__dialog-actions">
              <button
                type="button"
                className="meeting__dialog-yes"
                onClick={() => setAskNoTranscriptOpen(false)}
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type TranscriptListProps = {
  transcript: DisplaySegment[];
  query: string;
  activeMatch: number;
  occStartBySegment: Map<string, number>;
  activeSegmentId: string | null;
  playingSegmentId: string | null;
  linkedTaskSegmentId: string | null;
  activeMarkRef: RefObject<HTMLElement | null>;
  onSeek?: (ms: number) => void;
  onSaveSegment?: (
    segmentId: string,
    text: string,
    dropSegmentIds?: string[],
  ) => void | Promise<void>;
};

function TranscriptList({
  transcript,
  query,
  activeMatch,
  occStartBySegment,
  activeSegmentId,
  playingSegmentId,
  linkedTaskSegmentId,
  activeMarkRef,
  onSeek,
  onSaveSegment,
}: TranscriptListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleEdit = async (seg: DisplaySegment) => {
    if (!onSaveSegment) {
      return;
    }
    if (editingId === seg.id) {
      const next = draft.trim();
      if (!next || next === seg.text) {
        setEditingId(null);
        return;
      }
      setSaving(true);
      try {
        await onSaveSegment(seg.id, draft, seg.sourceIds.slice(1));
        setEditingId(null);
      } finally {
        setSaving(false);
      }
      return;
    }
    setEditingId(seg.id);
    setDraft(seg.text);
  };

  if (transcript.length === 0) {
    return <p className="meeting__muted">Пока нет расшифровки.</p>;
  }
  return (
    <ol className="meeting__transcript">
      {transcript.map((seg) => {
        const classes = ["meeting__transcript-line"];
        if (seg.id === activeSegmentId) {
          classes.push("meeting__transcript-line--active");
        }
        if (seg.id === playingSegmentId) {
          classes.push("meeting__transcript-line--playing");
        }
        if (seg.id === linkedTaskSegmentId) {
          classes.push("meeting__transcript-line--task");
        }
        const editing = editingId === seg.id;
        return (
          <li
            key={seg.id}
            id={segmentAnchorId(seg.id)}
            className={classes.join(" ")}
          >
            <span
              className={
                seg.id === playingSegmentId
                  ? "meeting__line-avatar meeting__line-avatar--playing"
                  : "meeting__line-avatar"
              }
              aria-hidden="true"
            >
              {speakerInitial(seg.speaker)}
            </span>
            <div className="meeting__line-body">
              <div className="meeting__line-head">
                <strong className="meeting__speaker">{seg.speaker}</strong>
                {onSeek ? (
                  <button
                    type="button"
                    className="meeting__time meeting__time--seek"
                    onClick={() => onSeek(seg.startedAtMs)}
                    title="Перемотать аудио к этому месту"
                  >
                    {formatTimecode(seg.startedAtMs)}
                  </button>
                ) : (
                  <time className="meeting__time">
                    {formatTimecode(seg.startedAtMs)}
                  </time>
                )}
                {seg.id === playingSegmentId ? (
                  <span className="meeting__now-playing">сейчас играет</span>
                ) : null}
              </div>
              {editing ? (
                <textarea
                  className="meeting__line-edit"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  disabled={saving}
                  aria-label="Текст фрагмента"
                />
              ) : (
                <p className="meeting__line">
                  {highlightMatches(
                    seg.text,
                    query,
                    occStartBySegment.get(seg.id) ?? -1,
                    activeMatch,
                    activeMarkRef,
                  )}
                </p>
              )}
            </div>
            {onSaveSegment ? (
              <button
                type="button"
                className={
                  editing
                    ? "meeting__line-toggle meeting__line-toggle--save"
                    : "meeting__line-toggle"
                }
                onClick={() => void toggleEdit(seg)}
                disabled={saving}
                aria-label={editing ? "Сохранить фрагмент" : "Править фрагмент"}
                title={editing ? "Сохранить" : "Править"}
              >
                {editing ? <SaveIcon /> : <PencilIcon />}
              </button>
            ) : null}
          </li>
        );
      })}
      <li className="meeting__transcript-pad" aria-hidden="true" />
    </ol>
  );
}

function highlightMatches(
  text: string,
  query: string,
  occStart: number,
  activeMatch: number,
  activeMarkRef: RefObject<HTMLElement | null>,
): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle || occStart < 0) {
    return text;
  }
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let occ = occStart;
  let idx = lower.indexOf(needle);
  while (idx !== -1) {
    if (idx > from) {
      parts.push(text.slice(from, idx));
    }
    const isActive = occ === activeMatch;
    parts.push(
      <mark
        key={idx}
        ref={isActive ? activeMarkRef : undefined}
        className={
          isActive ? "meeting__mark meeting__mark--active" : "meeting__mark"
        }
      >
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    from = idx + needle.length;
    occ += 1;
    idx = lower.indexOf(needle, from);
  }
  if (from < text.length) {
    parts.push(text.slice(from));
  }
  return parts;
}

function CountPill({ value, label }: { value: number; label: string }) {
  return (
    <span className="meeting__count-pill">
      <span className="meeting__count-value">{value}</span>
      <span className="meeting__count-label">{label}</span>
    </span>
  );
}

function taskWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "задачу";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "задачи";
  }
  return "задач";
}

type MeetingPlayerProps = {
  meetingId: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  currentSec: number;
  durationSec: number;
  muted: boolean;
  onPlayingChange: (playing: boolean) => void;
  onCurrentSecChange: (sec: number) => void;
  onDurationSecChange: (sec: number) => void;
  onMutedChange: (muted: boolean) => void;
};

function MeetingPlayer({
  meetingId,
  audioRef,
  playing,
  currentSec,
  durationSec,
  muted,
  onPlayingChange,
  onCurrentSecChange,
  onDurationSecChange,
  onMutedChange,
}: MeetingPlayerProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const progressPct =
    durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0;

  const cyclePlaybackRate = () => {
    const index = PLAYBACK_RATES.findIndex((rate) => rate === playbackRate);
    const next =
      PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? PLAYBACK_RATES[0];
    setPlaybackRate(next);
    const el = audioRef.current;
    if (el) {
      el.playbackRate = next;
    }
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) {
      return;
    }
    if (el.paused) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  };

  const seekByClientX = (clientX: number) => {
    const el = audioRef.current;
    const track = progressRef.current;
    if (!el || !track || !Number.isFinite(el.duration) || el.duration <= 0) {
      return;
    }
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    onCurrentSecChange(el.currentTime);
  };

  const toggleMute = () => {
    const el = audioRef.current;
    const next = !muted;
    onMutedChange(next);
    if (el) {
      el.muted = next;
    }
  };

  return (
    <div className="meeting__player">
      <audio
        ref={audioRef}
        className="meeting__player-audio"
        preload="metadata"
        src={`/api/meetings/${meetingId}/audio`}
        onLoadedMetadata={(event) => {
          const el = event.currentTarget;
          onDurationSecChange(Number.isFinite(el.duration) ? el.duration : 0);
          el.muted = muted;
          el.playbackRate = playbackRate;
        }}
        onPlay={() => onPlayingChange(true)}
        onPause={() => onPlayingChange(false)}
        onTimeUpdate={(event) => {
          const el = event.currentTarget;
          onCurrentSecChange(el.currentTime);
        }}
        onEnded={() => onPlayingChange(false)}
      />
      <button
        type="button"
        className="meeting__player-play"
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        onClick={togglePlay}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="meeting__player-time">
        {formatTimecode(currentSec * 1000)}
        {" / "}
        {formatTimecode(durationSec * 1000)}
      </span>
      <div
        ref={progressRef}
        className="meeting__player-progress"
        role="slider"
        aria-label="Позиция воспроизведения"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={currentSec}
        tabIndex={0}
        onClick={(event) => seekByClientX(event.clientX)}
        onKeyDown={(event) => {
          const el = audioRef.current;
          if (!el || !Number.isFinite(el.duration)) {
            return;
          }
          const step = event.shiftKey ? 10 : 5;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            el.currentTime = Math.min(el.duration, el.currentTime + step);
            onCurrentSecChange(el.currentTime);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            el.currentTime = Math.max(0, el.currentTime - step);
            onCurrentSecChange(el.currentTime);
          }
        }}
      >
        <div className="meeting__player-track">
          <div
            className="meeting__player-played"
            style={{ width: `${progressPct}%` }}
          >
            <span className="meeting__player-playhead" aria-hidden="true" />
          </div>
        </div>
      </div>
      <button
        type="button"
        className="meeting__player-speed"
        aria-label="Скорость воспроизведения"
        onClick={cyclePlaybackRate}
      >
        {formatPlaybackRate(playbackRate)}
      </button>
      <button
        type="button"
        className="meeting__player-icon-btn"
        aria-label={muted ? "Включить звук" : "Выключить звук"}
        aria-pressed={muted}
        onClick={toggleMute}
      >
        <VolumeIcon muted={muted} />
      </button>
      <a
        className="meeting__player-icon-btn meeting__player-download"
        href={`/api/meetings/${meetingId}/audio`}
        download={recordDownloadName()}
        aria-label="Скачать запись"
      >
        <DownloadIcon />
      </a>
    </div>
  );
}

function SummaryBlock({
  title,
  children,
}: {
  title: string;
  dotClass?: string;
  children: ReactNode;
}) {
  return (
    <div className="meeting__summary-block">
      <h3 className="meeting__block-title">{title}</h3>
      <div className="meeting__summary-items">{children}</div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function AskIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 1.5-2.5 4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 5L6 9H3v6h3l5 4V5z" />
        <path d="M23 9l-6 6M17 9l6 6" />
      </svg>
    );
  }
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 010 7.07" />
      <path d="M19.07 4.93a10 10 0 010 14.14" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8L16.5 17.5l1.8-.7L19 15z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}
