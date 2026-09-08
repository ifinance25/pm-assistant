import { Link } from "react-router-dom";
import type {
  CalendarEvent,
  CalendarFeed,
  Meeting,
  MeetingStatus,
  Platform,
} from "../../../shared/types.ts";
import "./calendar.css";

const PLATFORM_LABEL: Record<Platform, string> = {
  zoom: "Zoom",
  meet: "Google Meet",
  telemost: "Яндекс Телемост",
  unknown: "Платформа",
};

const LIVE_INPUT_HINT = "Живой вход пока только для Zoom";

export type CalendarViewProps = {
  feed: CalendarFeed;
  meetings: Meeting[];
  onSendBot: (event: CalendarEvent) => void;
  sendingEventId: string | null;
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
    "waiting_room",
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

type EventCta =
  | { kind: "open"; to: string }
  | { kind: "disabled"; hint: string }
  | { kind: "send" };

function eventCta(event: CalendarEvent): EventCta {
  if (event.meetingId) {
    return { kind: "open", to: `/meetings/${event.meetingId}` };
  }
  if (!event.supported) {
    return { kind: "disabled", hint: LIVE_INPUT_HINT };
  }
  return { kind: "send" };
}

function CalendarEventRow({
  event,
  onSendBot,
  sending,
}: {
  event: CalendarEvent;
  onSendBot: (event: CalendarEvent) => void;
  sending: boolean;
}) {
  const cta = eventCta(event);
  return (
    <li className="calendar__item">
      <div className="calendar__item-body">
        <span className="calendar__item-title">{event.title}</span>
        <span className="calendar__item-meta">
          <time dateTime={event.startsAt}>{formatRowWhen(event.startsAt)}</time>
          {" · "}
          {PLATFORM_LABEL[event.platform]}
        </span>
        <span className="calendar__item-url">{event.url}</span>
      </div>
      {cta.kind === "open" ? (
        <Link className="calendar__open" to={cta.to}>
          Открыть
        </Link>
      ) : cta.kind === "disabled" ? (
        <button
          className="calendar__open"
          type="button"
          disabled
          title={cta.hint}
        >
          Отправить бота
        </button>
      ) : (
        <button
          className="calendar__open"
          type="button"
          disabled={sending}
          onClick={() => onSendBot(event)}
        >
          Отправить бота
        </button>
      )}
    </li>
  );
}

function CalendarEventList({
  events,
  onSendBot,
  sendingEventId,
}: {
  events: CalendarEvent[];
  onSendBot: (event: CalendarEvent) => void;
  sendingEventId: string | null;
}) {
  return (
    <ul className="calendar__list">
      {events.map((event) => (
        <CalendarEventRow
          key={event.id}
          event={event}
          onSendBot={onSendBot}
          sending={sendingEventId === event.id}
        />
      ))}
    </ul>
  );
}

export function CalendarView({
  feed,
  meetings,
  onSendBot,
  sendingEventId,
}: CalendarViewProps) {
  if (feed.expired) {
    return (
      <section className="calendar">
        <header className="calendar__header">
          <h1 className="calendar__title">Календарь</h1>
        </header>
        <aside className="calendar__banner">
          <p className="calendar__banner-title">
            Google Календарь: подключение истекло
          </p>
          <p className="calendar__banner-text">
            Подключение к Google истекло, подключите календарь заново.
          </p>
          <Link className="calendar__open" to="/settings#integrations">
            Подключить в Настройках
          </Link>
        </aside>
      </section>
    );
  }

  if (!feed.connected) {
    return (
      <section className="calendar">
        <header className="calendar__header">
          <h1 className="calendar__title">Календарь</h1>
          <p className="calendar__lead">Выключен. Бот идёт только по ссылке.</p>
        </header>
        <aside className="calendar__banner">
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

  return (
    <section className="calendar">
      <header className="calendar__header">
        <h1 className="calendar__title">Календарь</h1>
        <p className="calendar__lead">
          Звонки на 7 дней вперёд из Google Календаря.
        </p>
      </header>
      {feed.events.length === 0 ? (
        <p className="calendar__empty">
          На ближайшие 7 дней звонков не найдено.
        </p>
      ) : (
        <CalendarEventList
          events={feed.events}
          onSendBot={onSendBot}
          sendingEventId={sendingEventId}
        />
      )}
    </section>
  );
}
