import { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./archive.css";

export type ArchiveHit = {
  id: string;
  title: string | null;
  platform: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  snippet: string;
  href: string;
  projectName?: string | null;
  epicKey?: string | null;
  matchCount: number;
  decisionCount: number;
  taskCount: number;
};

export type ArchiveFilters = {
  platform: string;
  period: string;
  status: string;
  projectId: string;
};

export type ArchiveProjectChip = {
  id: string;
  name: string;
};

export type ArchiveContext = {
  id: string;
  title: string;
  platform: string;
  startedAt: string | null;
  durationLabel: string | null;
  snippet: string;
  href: string;
  projectName: string | null;
  epicKey: string | null;
  fragmentCount: number;
  decisionCount: number;
  taskCount: number;
};

export type ArchiveViewProps = {
  query: string;
  filters: ArchiveFilters;
  projects: ArchiveProjectChip[];
  results: ArchiveHit[];
  selectedId: string | null;
  selected: ArchiveContext | null;
  meetingCount: number;
  projectCount: number;
  loading?: boolean;
  onToggleFilter?: (group: keyof ArchiveFilters, id: string) => void;
  onSelect?: (id: string) => void;
  onQuerySubmit?: (query: string) => void;
};

export type SearchHit = {
  id: string;
  title: string | null;
  platform: string;
  status: string;
  startedAt: string | null;
  endedAt?: string | null;
  snippet: string;
  href: string;
  projectName?: string | null;
  epicKey?: string | null;
  matchCount?: number;
  decisionCount?: number;
  taskCount?: number;
};

export function hitsFromSearch(apiHits: SearchHit[]): ArchiveHit[] {
  return apiHits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    platform: hit.platform,
    status: hit.status,
    startedAt: hit.startedAt,
    endedAt: hit.endedAt ?? null,
    snippet: hit.snippet,
    href: hit.href,
    projectName: hit.projectName ?? null,
    epicKey: hit.epicKey ?? null,
    matchCount: hit.matchCount ?? 0,
    decisionCount: hit.decisionCount ?? 0,
    taskCount: hit.taskCount ?? 0,
  }));
}

const PLATFORM_LABEL: Record<string, string> = {
  zoom: "Zoom",
  meet: "Google Meet",
  telemost: "Яндекс Телемост",
  unknown: "Другое",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Очередь",
  joining: "Вход",
  recording: "Запись",
  transcribing: "Расшифровка",
  summarizing: "Резюме",
  ready: "Готово",
  error: "Ошибка",
};

const STATUS_CHIPS = [
  { id: "ready", label: "Готово" },
  { id: "recording", label: "Запись" },
] as const;

function chipClass(active: boolean): string {
  return active ? "archive__chip archive__chip--active" : "archive__chip";
}

function badgeClass(status: string): string {
  if (status === "recording" || status === "joining") {
    return "archive__badge archive__badge--live";
  }
  if (status === "error") {
    return "archive__badge archive__badge--error";
  }
  return "archive__badge archive__badge--done";
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}

function meetingWord(count: number): string {
  return plural(count, "расшифровка", "расшифровки", "расшифровок");
}

function projectWord(count: number): string {
  return plural(count, "проекте", "проектах", "проектах");
}

function formatDay(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date
    .toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
    .replace(".", "");
}

export function durationLabel(
  startedAt: string | null,
  endedAt: string | null,
  status: string,
): string | null {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  const end = endedAt
    ? Date.parse(endedAt)
    : status === "recording"
      ? Date.now()
      : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return `${Math.round((end - start) / 60_000)} мин`;
}

function whenLabel(startedAt: string | null, status: string): string {
  if (status === "recording") {
    return "сейчас";
  }
  return formatDay(startedAt);
}

function cardMeta(hit: ArchiveHit): string {
  const parts = [
    PLATFORM_LABEL[hit.platform] ?? hit.platform,
    durationLabel(hit.startedAt, hit.endedAt, hit.status),
    whenLabel(hit.startedAt, hit.status),
    hit.projectName,
  ].filter(Boolean);
  return parts.join(" · ");
}

function detailMeta(selected: ArchiveContext): string {
  const day = formatDay(selected.startedAt);
  const platform = PLATFORM_LABEL[selected.platform] ?? selected.platform;
  const project = selected.projectName ? `проект ${selected.projectName}` : "";
  return [day, platform, project].filter(Boolean).join(" · ");
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().split(/\s+/)[0] ?? "";
  if (!needle) {
    return text;
  }
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
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

export function ArchiveView(props: ArchiveViewProps) {
  const navigate = useNavigate();
  const { filters, onToggleFilter, projects } = props;

  function openMeeting(href: string): void {
    navigate(href);
  }

  function onSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    props.onQuerySubmit?.(String(data.get("q") ?? "").trim());
  }

  return (
    <section className="archive">
      <header className="archive__header">
        <div className="archive__heading">
          <h1 className="archive__title">Транскрибации</h1>
          <p className="archive__lead">
            {`${props.meetingCount} ${meetingWord(props.meetingCount)} в ${props.projectCount} ${projectWord(props.projectCount)}`}
          </p>
        </div>
        <form className="archive__search" role="search" onSubmit={onSearch}>
          <span className="archive__search-icon">
            <SearchIcon />
          </span>
          <input
            className="archive__search-input"
            type="search"
            name="q"
            defaultValue={props.query}
            key={props.query}
            placeholder="Найти встречу или фразу"
            aria-label="Найти встречу или фразу"
            autoComplete="off"
          />
        </form>
      </header>

      <div className="archive__filters" aria-label="Фильтры">
        <button
          type="button"
          className={chipClass(!filters.projectId)}
          onClick={() => onToggleFilter?.("projectId", "")}
        >
          Все проекты
        </button>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={chipClass(filters.projectId === project.id)}
            onClick={() => onToggleFilter?.("projectId", project.id)}
          >
            {project.name}
          </button>
        ))}
        <span className="archive__filters-divider" aria-hidden="true" />
        {STATUS_CHIPS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={chipClass(filters.status === item.id)}
            onClick={() => onToggleFilter?.("status", item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="archive__body">
        <div className="archive__feed">
          {props.loading ? (
            <p className="archive__empty">Загружаем…</p>
          ) : props.results.length === 0 ? (
            <p className="archive__empty">
              {props.query.trim()
                ? "Ничего не найдено. Измените запрос или сбросьте фильтры."
                : "Пока нет расшифровок."}
            </p>
          ) : (
            <ul className="archive__hits">
              {props.results.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className={
                      props.selectedId === hit.id
                        ? "archive__card archive__card--active"
                        : "archive__card"
                    }
                    data-meeting-href={hit.href}
                    onClick={() => props.onSelect?.(hit.id)}
                    onDoubleClick={() => openMeeting(hit.href)}
                  >
                    <div className="archive__card-row">
                      <h3 className="archive__card-title">
                        {hit.title ?? "Встреча без названия"}
                      </h3>
                      <span className={badgeClass(hit.status)}>
                        {STATUS_LABEL[hit.status] ?? hit.status}
                      </span>
                    </div>
                    <p className="archive__card-meta">{cardMeta(hit)}</p>
                    {hit.snippet ? (
                      <p className="archive__snippet">
                        <Highlight text={hit.snippet} query={props.query} />
                      </p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="archive__context" aria-label="Контекст встречи">
          {props.selected ? (
            <>
              <h2 className="archive__context-title">{props.selected.title}</h2>
              <p className="archive__context-meta">{detailMeta(props.selected)}</p>
              {props.selected.epicKey ? (
                <p className="archive__epic">{`Epic ${props.selected.epicKey}`}</p>
              ) : null}
              {props.selected.snippet ? (
                <p className="archive__summary">{props.selected.snippet}</p>
              ) : null}
              <ul className="archive__stats">
                <li>
                  <span className="archive__stat-n">
                    {props.selected.fragmentCount}
                  </span>
                  <span>
                    {plural(
                      props.selected.fragmentCount,
                      "фрагмент",
                      "фрагмента",
                      "фрагментов",
                    )}
                  </span>
                </li>
                <li>
                  <span className="archive__stat-n">
                    {props.selected.decisionCount}
                  </span>
                  <span>
                    {plural(
                      props.selected.decisionCount,
                      "решение",
                      "решения",
                      "решений",
                    )}
                  </span>
                </li>
                <li>
                  <span className="archive__stat-n">
                    {props.selected.taskCount}
                  </span>
                  <span>
                    {plural(props.selected.taskCount, "задача", "задачи", "задач")}
                  </span>
                </li>
              </ul>
              <Link className="archive__open" to={props.selected.href}>
                Открыть встречу
              </Link>
            </>
          ) : (
            <p className="archive__context-empty">
              Выберите встречу в списке, чтобы увидеть контекст.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
