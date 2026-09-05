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
  realtimeCaption,
} from "../../../shared/types.ts";
import { REVIEW_SKIPPED_NOTICE } from "../../../adapters/llm/pending.ts";

const STATUS_LABEL: Record<MeetingStatus, string> = {
  queued: "В очереди",
  joining: "Подключение",
  recording: "Идёт запись",
  transcribing: "Расшифровка",
  summarizing: "Готовим резюме",
  ready: "Готово",
  error: "Ошибка",
};

export type MeetingViewProps = {
  detail: MeetingDetail;
  projectName?: string | null;
  epicKey?: string | null;
  trackerLabel: string;
  trackerNotice?: string | null;
  onCreateTasks?: () => void;
  onRetry?: () => void;
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

export function formatTimecode(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

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

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `до ${dd}.${mm}`;
}

function durationLabel(meeting: Meeting): string | null {
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

function splitLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
}

function segmentAnchorId(id: string): string {
  return `segment-${id}`;
}

function itemAnchor(item: ActionItem, transcript: TranscriptSegment[]): string | null {
  if (item.segmentId) {
    return `#${segmentAnchorId(item.segmentId)}`;
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
  epicKey = null,
  trackerLabel,
  trackerNotice,
  onCreateTasks,
  onRetry,
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
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [playingMs, setPlayingMs] = useState<number | null>(null);
  const [askQuestion, setAskQuestion] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeMarkRef = useRef<HTMLElement>(null);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [] as { segmentId: string; offset: number }[];
    }
    const found: { segmentId: string; offset: number }[] = [];
    for (const seg of transcript) {
      const lower = seg.text.toLowerCase();
      let from = lower.indexOf(q);
      while (from !== -1) {
        found.push({ segmentId: seg.id, offset: from });
        from = lower.indexOf(q, from + q.length);
      }
    }
    return found;
  }, [transcript, query]);
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
    for (const seg of transcript) {
      if (seg.startedAtMs <= playingMs) {
        current = seg.id;
      } else {
        break;
      }
    }
    return current;
  }, [transcript, playingMs]);
  useEffect(() => {
    activeMarkRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeMatch]);
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
  const createLabel =
    pending.length > 0
      ? `Создать ${pending.length} ${taskWord(pending.length)} в ${resolvedTrackerLabel}`
      : queued.length > 0
        ? "Задачи к созданию"
        : created.length > 0
          ? `Задачи созданы в ${resolvedTrackerLabel}`
          : "Нет задач для создания";
  const createDisabled = pending.length === 0;
  const datePart = meeting.startedAt ? formatDate(meeting.startedAt) : null;
  const duration = durationLabel(meeting);
  const decisions = summary ? splitLines(summary.decisions) : [];
  const risks = summary ? splitLines(summary.risks) : [];

  return (
    <section className="meeting">
      <header className="meeting__header">
        <div>
          <p className="meeting__crumb">
            <Link to="/">Главная</Link>
          </p>
          <h1 className="meeting__title">
            {meeting.title || "Итоги встречи"}
          </h1>
          <p className="meeting__subtitle">
            {[projectName, datePart, duration, epicKey ? `Epic ${epicKey}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div
          className={`meeting__badge meeting__badge--${meeting.status}`}
        >
          <span className="meeting__badge-dot" aria-hidden="true" />
          {STATUS_LABEL[meeting.status]}
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
        <div className="meeting__player">
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={`/api/meetings/${meeting.id}/audio`}
            onTimeUpdate={(e) => setPlayingMs(e.currentTarget.currentTime * 1000)}
          >
            Ваш браузер не поддерживает воспроизведение звука.
          </audio>
        </div>
      ) : null}

      {isRealtime ? (
        <p className="meeting__progress">
          Сейчас: {STATUS_LABEL[meeting.status]}. Сегменты появляются по ходу.
        </p>
      ) : meeting.status !== "ready" && meeting.status !== "error" ? (
        <p className="meeting__progress">
          Сейчас: {STATUS_LABEL[meeting.status]}. Транскрипт и задачи появятся,
          когда обработка закончится.
        </p>
      ) : null}

      <div className="meeting__layout">
        <section className="meeting__main" aria-labelledby="transcript-heading">
          <h2 id="transcript-heading" className="meeting__col-title">
            Транскрипт встречи
          </h2>
          {showRealtimeCaption ? (
            <p className="meeting__realtime">{caption}</p>
          ) : null}
          <div className="meeting__search">
            <span className="meeting__search-icon" aria-hidden="true">
              ⌕
            </span>
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
            <button
              type="button"
              className="meeting__search-nav"
              onClick={() => goToMatch(-1)}
              disabled={matchCount === 0}
              aria-label="Предыдущее совпадение"
            >
              ↑
            </button>
            <button
              type="button"
              className="meeting__search-nav"
              onClick={() => goToMatch(1)}
              disabled={matchCount === 0}
              aria-label="Следующее совпадение"
            >
              ↓
            </button>
          </div>
          <TranscriptList
            transcript={transcript}
            query={query}
            activeMatch={activeMatch}
            occStartBySegment={occStartBySegment}
            activeSegmentId={activeSegmentId}
            playingSegmentId={playingSegmentId}
            activeMarkRef={activeMarkRef}
            onSeek={hasAudio ? seekTo : undefined}
          />
        </section>

        <aside className="meeting__side" aria-label="Обзор и задачи">
          <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="meeting__col-title">
            Краткое резюме
          </h2>
          <div className="meeting__result">
            <h3 className="meeting__block-title">Основной результат</h3>
            <p>{summary?.headline || "Резюме ещё не готово."}</p>
          </div>
          <div className="meeting__block">
            <h3 className="meeting__block-title">Решения</h3>
            {decisions.length > 0 ? (
              <ul>
                {decisions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="meeting__muted">Пока нет.</p>
            )}
          </div>
          <div className="meeting__block">
            <h3 className="meeting__block-title">Риски</h3>
            {risks.length > 0 ? (
              <ul>
                {risks.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="meeting__muted">Пока нет.</p>
            )}
          </div>
          <div className="meeting__block">
            <h3 className="meeting__block-title">Следующий шаг</h3>
            <p>{summary?.nextStep || "Пока нет."}</p>
          </div>
          <div className="meeting__stats">
            <Stat value={transcript.length} label="фрагментов" />
            <Stat value={decisions.length} label="решения" />
            <Stat value={actionItems.length} label="задачи" />
          </div>
          </section>

          <section aria-labelledby="tasks-heading">
          <h2 id="tasks-heading" className="meeting__col-title">
            Задачи из встречи
          </h2>
          <p className="meeting__hint">
            {`Без подключённого ${resolvedTrackerLabel} кнопка только помечает задачи к созданию.`}
          </p>
          <button
            type="button"
            className="meeting__tracker"
            disabled={createDisabled}
            onClick={createTasks}
          >
            {createLabel}
          </button>
          {resolvedNotice ? (
            <p className="meeting__tracker-notice">{resolvedNotice}</p>
          ) : null}
          <ul className="meeting__tasks">
            {actionItems.map((item) => {
              const href = itemAnchor(item, transcript);
              const when = item.dueAt ? formatDue(item.dueAt) : null;
              return (
                <li key={item.id} className="meeting__task">
                  <div className="meeting__task-top">
                    <span className="meeting__avatar" aria-hidden="true">
                      {(item.assignee ?? "?").slice(0, 1)}
                    </span>
                    <span className="meeting__assignee">
                      {item.assignee ?? "без ответственного"}
                    </span>
                    {item.timecodeMs != null ? (
                      href ? (
                        <a className="meeting__timecode" href={href}>
                          {formatTimecode(item.timecodeMs)}
                        </a>
                      ) : (
                        <span className="meeting__timecode">
                          {formatTimecode(item.timecodeMs)}
                        </span>
                      )
                    ) : null}
                  </div>
                  <p className="meeting__task-title">{item.title}</p>
                  <p className="meeting__tracker-state">
                    {`${resolvedTrackerLabel}: ${TRACKER_STATE_LABEL[item.trackerState]}`}
                  </p>
                  {when ? (
                    <p className="meeting__due">Когда: {when}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          </section>
          <form
            className="meeting__ask"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = askQuestion.trim();
              if (!trimmed || !onAsk) {
                return;
              }
              onAsk(trimmed);
            }}
          >
            <label htmlFor="meeting-ask">Спросить по этой встрече</label>
            <input
              id="meeting-ask"
              type="text"
              placeholder="Какие решения по бюджету?"
              value={askQuestion}
              onChange={(event) => setAskQuestion(event.target.value)}
              disabled={askBusy}
            />
            <button type="submit" className="meeting__ask-submit" disabled={askBusy}>
              {askBusy ? "Думаю…" : "Спросить"}
            </button>
            {askAnswer ? (
              <p className="meeting__ask-answer">{askAnswer}</p>
            ) : (
              <p className="meeting__muted">
                Подсказки: «Какие решения?» · «Что в Epic?»
              </p>
            )}
          </form>
        </aside>
      </div>
    </section>
  );
}

type TranscriptListProps = {
  transcript: TranscriptSegment[];
  query: string;
  activeMatch: number;
  occStartBySegment: Map<string, number>;
  activeSegmentId: string | null;
  playingSegmentId: string | null;
  activeMarkRef: RefObject<HTMLElement | null>;
  onSeek?: (ms: number) => void;
};

function TranscriptList({
  transcript,
  query,
  activeMatch,
  occStartBySegment,
  activeSegmentId,
  playingSegmentId,
  activeMarkRef,
  onSeek,
}: TranscriptListProps) {
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
        return (
          <li
            key={seg.id}
            id={segmentAnchorId(seg.id)}
            className={classes.join(" ")}
          >
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
            <strong className="meeting__speaker">{seg.speaker}</strong>
            <p className="meeting__line">
              {highlightMatches(
                seg.text,
                query,
                occStartBySegment.get(seg.id) ?? -1,
                activeMatch,
                activeMarkRef,
              )}
            </p>
          </li>
        );
      })}
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="meeting__stat">
      <span className="meeting__stat-value">{value}</span>
      <span className="meeting__stat-label">{label}</span>
    </div>
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
