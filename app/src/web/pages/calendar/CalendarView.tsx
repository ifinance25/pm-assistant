import { Link } from "react-router-dom";
import type { Meeting, MeetingStatus, Platform } from "../../../shared/types.ts";
import "./calendar.css";

const PLATFORM_LABEL: Record<Platform, string> = {
  zoom: "Zoom",
  meet: "Google Meet",
  telemost: "Яндекс Телемост",
  unknown: "Платформа",
};

export type CalendarViewProps = {
  meetings: Meeting[];
};

function formatRowWhen(iso: string | null): string {
  if (!iso) {
    return "время не задано";
  }
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) {
    return `сегодня ${time}`;
  }
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function meetingCta(meeting: Meeting): { label: string; to: string } {
  const openStatuses = new Set<MeetingStatus>([
    "recording",
    "transcribing",
    "summarizing",
    "ready",
    "error",
  ]);
  if (openStatuses.has(meeting.status)) {
    return { label: "Открыть", to: `/meetings/${meeting.id}` };
  }
  return {
    label: "Отправить бота",
    to: `/?url=${encodeURIComponent(meeting.url)}`,
  };
}

export function CalendarList({
  meetings,
  compact = false,
}: {
  meetings: Meeting[];
  compact?: boolean;
}) {
  if (meetings.length === 0) {
    return null;
  }

  return (
    <ul
      className={
        compact ? "calendar__list calendar__list--compact" : "calendar__list"
      }
    >
      {meetings.map((meeting) => {
        const cta = meetingCta(meeting);
        return (
          <li key={meeting.id} className="calendar__item">
            <div className="calendar__item-body">
              <span className="calendar__item-title">
                {meeting.title ?? meeting.url}
              </span>
              <span className="calendar__item-meta">
                <time dateTime={meeting.startedAt ?? undefined}>
                  {formatRowWhen(meeting.startedAt)}
                </time>
                {" · "}
                {PLATFORM_LABEL[meeting.platform]}
              </span>
              <span className="calendar__item-url">{meeting.url}</span>
            </div>
            <Link className="calendar__open" to={cta.to}>
              {cta.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function CalendarView({ meetings }: CalendarViewProps) {
  return (
    <section className="calendar">
      <header className="calendar__header">
        <h1 className="calendar__title">Календарь</h1>
        <p className="calendar__lead">Выключен. Бот идёт только по ссылке.</p>
      </header>
      <aside className="calendar__banner">
        <p className="calendar__banner-title">Google Календарь: не подключён</p>
        <p className="calendar__banner-text">
          Живой календарь в этой версии не подключается. Встречи ниже уже есть в
          базе, бот запускается с Главной по URL.
        </p>
        <Link className="calendar__open" to="/settings#integrations">
          Подключить в Настройках
        </Link>
      </aside>
      {meetings.length === 0 ? (
        <p className="calendar__empty">
          Пока нет сохранённых встреч.{" "}
          <Link to="/">Вставьте ссылку на встречу на Главной</Link>.
        </p>
      ) : (
        <CalendarList meetings={meetings} />
      )}
    </section>
  );
}
