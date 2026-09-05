import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { detectPlatform } from "../../../adapters/platform/detect.ts";
import type {
  CalendarEvent,
  Meeting,
  MeetingStatus,
  Platform,
  Project,
} from "../../../shared/types.ts";
import "./home.css";

export type StorageStats = {
  meetingCount: number;
  usedBytes: number;
};

export type HomeProject = Project & {
  lastMeeting: {
    id: string;
    title: string | null;
    status: MeetingStatus;
    startedAt: string | null;
  } | null;
};

export type HomeMeeting = Meeting & {
  headline?: string | null;
};

export type HomeViewProps = {
  meetings: HomeMeeting[];
  storage: StorageStats;
  projects: HomeProject[];
  projectCount: number;
  meetingCount: number;
  selectedProjectId: string;
  url: string;
  error: string | null;
  notice: string | null;
  busy: boolean;
  upcomingCalendarEvents?: CalendarEvent[];
  onUrlChange: (url: string) => void;
  onProjectChange: (projectId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSendBot: (meetingUrl: string, projectId?: string | null) => void;
};

const STATUS_LABEL: Record<MeetingStatus, string> = {
  queued: "В очереди",
  joining: "Входит",
  waiting_room: "Зал ожидания",
  recording: "Идёт запись",
  transcribing: "Расшифровка",
  summarizing: "Резюме",
  ready: "Готово",
  error: "Ошибка",
};

const PLATFORM_LABEL: Record<Platform, string> = {
  zoom: "Zoom",
  meet: "Google Meet",
  telemost: "Яндекс Телемост",
  unknown: "Платформа",
};

const STEPS: {
  id: MeetingStatus;
  title: string;
  caption: string;
}[] = [
  { id: "queued", title: "Очередь", caption: "Ссылка принята" },
  { id: "joining", title: "Вход", caption: "Бот подключается" },
  { id: "waiting_room", title: "Зал ожидания", caption: "Ждём хоста" },
  { id: "recording", title: "Запись", caption: "Запись: идёт звук" },
  { id: "transcribing", title: "Расшифровка", caption: "Речь в текст" },
  { id: "summarizing", title: "Резюме", caption: "Саммари и задачи" },
];

const PIPELINE: MeetingStatus[] = [
  "queued",
  "joining",
  "waiting_room",
  "recording",
  "transcribing",
  "summarizing",
];

const LIVE_STATUSES: MeetingStatus[] = [
  "joining",
  "waiting_room",
  "recording",
  "transcribing",
  "summarizing",
];

function meetingWord(count: number): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n10 === 1 && n100 !== 11) {
    return "расшифровка";
  }
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) {
    return "расшифровки";
  }
  return "расшифровок";
}

function projectWord(count: number): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n10 === 1 && n100 !== 11) {
    return "проекте";
  }
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) {
    return "проектах";
  }
  return "проектах";
}

function formatClock(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(iso: string | null): string {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

function formatMinutes(
  startIso: string | null,
  endIso: string | null,
  status?: Meeting["status"],
): string | null {
  if (!startIso) {
    return null;
  }
  const start = new Date(startIso).getTime();
  const end = endIso
    ? new Date(endIso).getTime()
    : status === "recording"
      ? Date.now()
      : Number.NaN;
  if (!Number.isFinite(end) || end <= start) {
    return null;
  }
  const minutes = Math.max(1, Math.round((end - start) / 60000));
  return `${minutes} мин`;
}

function formatLastAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) {
    return "сегодня";
  }
  if (days === 1) {
    return "вчера";
  }
  if (days >= 2 && days <= 4) {
    return `${days} дня назад`;
  }
  if (days < 7) {
    return `${days} дней назад`;
  }
  return formatDay(iso);
}

function trackerShort(ref: string): string {
  const value = ref.trim();
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? url.hostname;
  } catch {
    return value;
  }
}

function projectMetaLine(project: HomeProject): string {
  const parts: string[] = [];
  if (project.lastMeeting?.startedAt) {
    parts.push(`последняя ${formatLastAgo(project.lastMeeting.startedAt)}`);
  } else {
    parts.push("ещё без расшифровок");
  }
  const key = trackerShort(project.trackerProjectRef);
  if (key) {
    parts.push(key);
  }
  if (project.trackerParentRef) {
    parts.push(`Epic ${project.trackerParentRef}`);
  }
  return parts.join(" · ");
}

function meetingTitle(meeting: Meeting): string {
  if (meeting.title) {
    return meeting.title;
  }
  return `Встреча ${PLATFORM_LABEL[meeting.platform]}`;
}

function projectName(meeting: Meeting, projects: HomeProject[]): string {
  const project = projects.find((item) => item.id === meeting.projectId);
  return project?.name ?? "Свои";
}

function byStartedAtDesc(a: Meeting, b: Meeting): number {
  return (b.startedAt ?? b.id).localeCompare(a.startedAt ?? a.id);
}

function splitMeetings(meetings: HomeMeeting[]): {
  live: HomeMeeting | null;
  upcoming: HomeMeeting[];
  transcripts: HomeMeeting[];
} {
  const live =
    meetings
      .filter((meeting) => LIVE_STATUSES.includes(meeting.status))
      .sort(byStartedAtDesc)[0] ?? null;
  const upcoming = meetings
    .filter(
      (meeting) =>
        meeting.id !== live?.id &&
        (meeting.status === "queued" || meeting.status === "joining"),
    )
    .sort(byStartedAtDesc);
  const transcripts = meetings
    .filter(
      (meeting) =>
        meeting.status === "ready" ||
        meeting.status === "error" ||
        meeting.status === "transcribing" ||
        meeting.status === "summarizing",
    )
    .filter((meeting) => meeting.id !== live?.id)
    .sort(byStartedAtDesc);
  return { live, upcoming, transcripts };
}

function stepState(
  status: MeetingStatus,
  stepId: MeetingStatus,
): "done" | "active" | "todo" {
  if (status === "ready") {
    return "done";
  }
  const current = PIPELINE.indexOf(status === "error" ? "queued" : status);
  const index = PIPELINE.indexOf(stepId);
  if (current < 0) {
    return "todo";
  }
  if (index < current) {
    return "done";
  }
  if (index === current) {
    return "active";
  }
  return "todo";
}

function detectedLabel(url: string): string | null {
  const platform = detectPlatform(url.trim());
  if (platform === "meet") {
    return "Распознан Google Meet";
  }
  if (platform === "zoom") {
    return "Распознан Zoom";
  }
  if (platform === "telemost") {
    return "Распознан Яндекс Телемост";
  }
  return null;
}

function upcomingPill(meeting: Meeting): string {
  if (!meeting.startedAt) {
    return "Ссылка готова";
  }
  const diff = new Date(meeting.startedAt).getTime() - Date.now();
  if (diff > 0 && diff < 2 * 60 * 60 * 1000) {
    return `Через ${Math.max(1, Math.round(diff / 60000))} мин`;
  }
  return "Ссылка готова";
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

function CheckIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function StepCheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ArrowRightIcon() {
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
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function SendIcon() {
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
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  );
}

export function HomeView({
  meetings,
  projects,
  projectCount,
  meetingCount,
  selectedProjectId,
  url,
  error,
  notice,
  busy,
  upcomingCalendarEvents = [],
  onUrlChange,
  onProjectChange,
  onSubmit,
  onSendBot,
}: HomeViewProps) {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { live, upcoming, transcripts } = splitMeetings(meetings);
  const recognized = detectedLabel(url);
  const detectedPlatform = detectPlatform(url.trim());
  const liveCaption =
    STEPS.find((step) => step.id === live?.status)?.caption ?? null;
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null;
  const summaryLine = `${meetingCount} ${meetingWord(meetingCount)} в ${projectCount} ${projectWord(projectCount)}`;

  function onSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const query = String(data.get("q") ?? "").trim();
    navigate(query ? `/archive?q=${encodeURIComponent(query)}` : "/archive");
  }

  return (
    <section className="home">
      <header className="home__header">
        <h1 className="home__title">Главная</h1>
        <form className="home__search" role="search" onSubmit={onSearch}>
          <span className="home__search-icon">
            <SearchIcon />
          </span>
          <input
            name="q"
            className="home__search-input"
            placeholder="Найти встречу или фразу"
            aria-label="Найти встречу или фразу"
            autoComplete="off"
          />
        </form>
      </header>

      <form className="home__capture" onSubmit={onSubmit}>
        <h2 className="home__capture-title">Отправить бота на звонок</h2>
        <p className="home__capture-lead">
          Ссылка и проект: запись ляжет в выбранный проект. Бот зайдёт в звонок
          и запишет его.
        </p>
        <div className="home__capture-row">
          <input
            className="home__capture-input"
            value={url}
            onChange={(event) => onUrlChange(event.currentTarget.value)}
            placeholder="ссылка на встречу"
            aria-label="ссылка на встречу"
            autoComplete="off"
          />
          <div className="home__picker">
            <button
              type="button"
              className={
                selectedProject ? "home__picker-chip" : "home__picker-empty"
              }
              aria-expanded={pickerOpen}
              aria-haspopup="listbox"
              onClick={() => setPickerOpen((open) => !open)}
            >
              {selectedProject?.name ?? "Проект"}
            </button>
            {pickerOpen ? (
              <ul className="home__picker-menu" role="listbox" aria-label="Проект">
                {projects.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={project.id === selectedProjectId}
                      className={
                        project.id === selectedProjectId
                          ? "home__picker-item home__picker-item--active"
                          : "home__picker-item"
                      }
                      onClick={() => {
                        onProjectChange(project.id);
                        setPickerOpen(false);
                      }}
                    >
                      {project.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            className="home__btn home__btn--primary home__capture-submit"
            type="submit"
            disabled={busy}
          >
            Отправить бота
          </button>
        </div>
        <div className="home__capture-meta">
          <div className="home__platforms">
            <span
              className={
                detectedPlatform === "zoom"
                  ? "home__platform-chip home__platform-chip--active"
                  : "home__platform-chip"
              }
            >
              Zoom
            </span>
            <span
              className={
                detectedPlatform === "meet"
                  ? "home__platform-chip home__platform-chip--active"
                  : "home__platform-chip"
              }
            >
              Google Meet
            </span>
            <span
              className={
                detectedPlatform === "telemost"
                  ? "home__platform-chip home__platform-chip--active"
                  : "home__platform-chip"
              }
            >
              Яндекс Телемост
            </span>
          </div>
          {recognized ? (
            <p className="home__platform-hint">
              <CheckIcon />
              {recognized}
            </p>
          ) : null}
        </div>
        {error ? <p className="home__error">{error}</p> : null}
        {notice ? <p className="home__notice">{notice}</p> : null}
      </form>

      {upcomingCalendarEvents.length > 0 ? (
        <section
          className="home__calendar-preview"
          aria-label="Ближайшие звонки из календаря"
        >
          <div className="home__section-head">
            <h2 className="home__section-title">Ближайшие звонки</h2>
            <Link className="home__section-link" to="/calendar">
              Календарь
            </Link>
          </div>
          <ul className="home__queue">
            {upcomingCalendarEvents.map((event) => (
              <li key={event.id} className="home__queue-item">
                <div className="home__queue-row">
                  <div className="home__queue-left">
                    <span className="home__row-time">
                      {formatClock(event.startsAt) ?? "нет времени"}
                    </span>
                    <span className="home__queue-copy">
                      <span className="home__row-title">{event.title}</span>
                      <span className="home__row-platform">
                        {PLATFORM_LABEL[event.platform]}
                      </span>
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {live ? (
        <section className="home__live" aria-label="Живой звонок">
          <div className="home__live-row">
            <div className="home__live-meeting">
              <div className="home__live-title-row">
                <span className="home__live-rec" aria-hidden="true" />
                <h2 className="home__live-title">{meetingTitle(live)}</h2>
              </div>
              <p className="home__live-meta">
                {[
                  formatMinutes(live.startedAt, live.endedAt, live.status),
                  PLATFORM_LABEL[live.platform],
                  projectName(live, projects),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="home__live-stepper-col">
              <div className="home__stepper" aria-label="Ход расшифровки">
                {STEPS.map((step, index) => {
                  const state = stepState(live.status, step.id);
                  const connectorDone =
                    index < STEPS.length - 1 &&
                    stepState(live.status, STEPS[index].id) === "done";
                  return (
                    <div key={step.id} className="home__step-group">
                      <div className={`home__step home__step--${state}`}>
                        <span
                          className={`home__step-dot home__step-dot--${state}`}
                          aria-hidden="true"
                        >
                          {state === "done" ? <StepCheckIcon /> : null}
                          {state === "active" ? (
                            <span className="home__step-dot-inner" />
                          ) : null}
                        </span>
                        <span className="home__step-label">{step.title}</span>
                      </div>
                      {index < STEPS.length - 1 ? (
                        <span
                          className={
                            connectorDone
                              ? "home__step-connector home__step-connector--done"
                              : "home__step-connector"
                          }
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {liveCaption ? (
                <p className="home__live-caption">{liveCaption}</p>
              ) : null}
            </div>
            <Link className="home__btn home__btn--open" to={`/meetings/${live.id}`}>
              Открыть
              <ArrowRightIcon />
            </Link>
          </div>
        </section>
      ) : null}

      <section className="home__projects" id="projects" aria-label="Проекты">
        <div className="home__section-head">
          <h2 className="home__section-title">Проекты</h2>
          <span className="home__section-meta">{summaryLine}</span>
        </div>
        {projects.length === 0 ? (
          <p className="home__empty-text">Пока нет проектов.</p>
        ) : (
          <ul className="home__project-list">
            {projects.map((project) => (
              <li key={project.id} className="home__project-row">
                <div className="home__project-copy">
                  <h3 className="home__project-name">{project.name}</h3>
                  <p className="home__project-meta">{projectMetaLine(project)}</p>
                </div>
                <Link
                  className="home__project-count"
                  to={`/archive?projectId=${encodeURIComponent(project.id)}`}
                >
                  {`${project.meetingCount ?? 0} ${meetingWord(project.meetingCount ?? 0)}`}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="home__columns">
        <section className="home__upcoming" aria-label="Следующие по ссылке">
          <div className="home__section-head">
            <h2 className="home__section-title">Следующие по ссылке</h2>
            <span className="home__section-meta">ссылки уже сохранены</span>
          </div>
          {upcoming.length === 0 ? (
            <div className="home__queue home__queue--empty">
              <p className="home__empty-text">
                Пока нет следующих звонков. Вставьте ссылку сверху, чтобы
                отправить бота.
              </p>
            </div>
          ) : (
            <ul className="home__queue">
              {upcoming.map((meeting) => {
                const pill = upcomingPill(meeting);
                return (
                  <li key={meeting.id} className="home__queue-item">
                    <div className="home__queue-row">
                      <div className="home__queue-left">
                        <span className="home__row-time">
                          {formatClock(meeting.startedAt) ?? "нет времени"}
                        </span>
                        <span className="home__queue-copy">
                          <span className="home__row-title">
                            {meetingTitle(meeting)}
                          </span>
                          <span className="home__row-platform">
                            {`${PLATFORM_LABEL[meeting.platform]} · ${projectName(meeting, projects)}`}
                          </span>
                        </span>
                      </div>
                      <div className="home__queue-right">
                        <span
                          className={
                            pill.startsWith("Через ")
                              ? "home__queue-pill home__queue-pill--soon"
                              : "home__queue-pill home__queue-pill--idle"
                          }
                        >
                          {pill}
                        </span>
                        <button
                          type="button"
                          className="home__btn home__btn--send"
                          disabled={busy}
                          onClick={() => onSendBot(meeting.url, meeting.projectId)}
                        >
                          <SendIcon />
                          Отправить бота
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="home__transcripts" aria-label="Последние расшифровки">
          <div className="home__section-head">
            <h2 className="home__section-title">Последние расшифровки</h2>
            <Link className="home__section-link" to="/archive">
              Все
            </Link>
          </div>
          {transcripts.length === 0 ? (
            <div className="home__queue home__queue--empty">
              <p className="home__empty-text">Пока нет расшифровок.</p>
            </div>
          ) : (
            <ul className="home__cards">
              {transcripts.map((meeting) => (
                <li key={meeting.id}>
                  <Link className="home__card" to={`/meetings/${meeting.id}`}>
                    <span className="home__card-row">
                      <span className="home__card-title">
                        {meetingTitle(meeting)}
                      </span>
                      <span
                        className={`home__pill home__pill--${meeting.status}`}
                      >
                        {STATUS_LABEL[meeting.status]}
                      </span>
                    </span>
                    <span className="home__card-meta">
                      {[
                        PLATFORM_LABEL[meeting.platform],
                        formatMinutes(
                          meeting.startedAt,
                          meeting.endedAt,
                          meeting.status,
                        ),
                        formatDay(meeting.startedAt),
                        projectName(meeting, projects),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {meeting.headline ? (
                      <span className="home__card-snippet">{meeting.headline}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
