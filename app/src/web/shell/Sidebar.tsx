import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { SessionInfo } from "../../shared/types.ts";
import {
  formatMeetingCount,
  formatStorageMb,
  storageFillPercent,
} from "./sidebar-utils.ts";

const items = [
  { to: "/", label: "Главная", icon: "house", end: true },
  { to: "/calendar", label: "Календарь", icon: "calendar", end: false },
  { to: "/archive", label: "Транскрибации", icon: "file-text", end: false },
  { to: "/settings", label: "Настройки", icon: "settings", end: false },
] as const;

type IconName =
  | (typeof items)[number]["icon"]
  | "audio-lines"
  | "panel-left-close"
  | "panel-left-open"
  | "log-out"
  | "hard-drive";

type SidebarViewProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  displayName?: string;
  initials?: string;
  meetingCount?: number;
  usedBytes?: number;
  loggingOut?: boolean;
  onLogout?: () => void;
};

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "audio-lines":
      return (
        <svg {...common}>
          <path d="M2 10v3" />
          <path d="M6 6v11" />
          <path d="M10 3v18" />
          <path d="M14 8v7" />
          <path d="M18 5v13" />
          <path d="M22 10v3" />
        </svg>
      );
    case "panel-left-close":
      return (
        <svg {...common} width={14} height={14}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
          <path d="m16 15-3-3 3-3" />
        </svg>
      );
    case "panel-left-open":
      return (
        <svg {...common} width={14} height={14}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
          <path d="m14 9 3 3-3 3" />
        </svg>
      );
    case "house":
      return (
        <svg {...common}>
          <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
          <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case "file-text":
      return (
        <svg {...common}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "log-out":
      return (
        <svg {...common} width={13} height={13}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" x2="9" y1="12" y2="12" />
        </svg>
      );
    case "hard-drive":
      return (
        <svg {...common} width={16} height={16}>
          <line x1="22" x2="2" y1="12" y2="12" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          <line x1="6" x2="6.01" y1="16" y2="16" />
          <line x1="10" x2="10.01" y1="16" y2="16" />
        </svg>
      );
  }
}

export function SidebarView({
  collapsed,
  onToggleCollapsed,
  displayName = "Пользователь",
  initials = "П",
  meetingCount = 0,
  usedBytes = 0,
  loggingOut = false,
  onLogout,
}: SidebarViewProps) {
  const storageMb = formatStorageMb(usedBytes);
  const storageLine = `${formatMeetingCount(meetingCount)} · ${storageMb} МБ`;
  const fillPercent = storageFillPercent(usedBytes);

  return (
    <aside
      className={collapsed ? "sidebar sidebar--collapsed" : "sidebar"}
      aria-label="Навигация приложения"
    >
      <div className="sidebar__top">
        {collapsed ? (
          <div className="sidebar__brand sidebar__brand--collapsed">
            <div className="sidebar__mark" aria-hidden="true">
              <Icon name="audio-lines" />
            </div>
            <button
              type="button"
              className="sidebar__toggle"
              onClick={onToggleCollapsed}
              aria-label="Развернуть меню"
              aria-expanded={false}
            >
              <Icon name="panel-left-open" />
            </button>
          </div>
        ) : (
          <div className="sidebar__brand">
            <div className="sidebar__mark" aria-hidden="true">
              <Icon name="audio-lines" />
            </div>
            <div className="sidebar__name">PM Assistant</div>
            <button
              type="button"
              className="sidebar__toggle"
              onClick={onToggleCollapsed}
              aria-label="Свернуть меню"
              aria-expanded={true}
            >
              <Icon name="panel-left-close" />
            </button>
          </div>
        )}

        <nav className="sidebar__nav" aria-label="Основное меню">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-icon={item.icon}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                isActive ? "sidebar__item sidebar__item--active" : "sidebar__item"
              }
            >
              <Icon name={item.icon} />
              {!collapsed ? <span>{item.label}</span> : null}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="sidebar__footer">
        {collapsed ? (
          <div className="sidebar__storage-compact" aria-label={storageLine}>
            <Icon name="hard-drive" />
            <span>{storageMb}</span>
          </div>
        ) : (
          <div className="sidebar__storage-block">
            <div className="sidebar__storage">{storageLine}</div>
            <div
              className="sidebar__storage-track"
              aria-hidden="true"
            >
              <div
                className="sidebar__storage-fill"
                style={{ width: `${fillPercent}%` }}
              />
            </div>
            <div className="sidebar__storage-hint">
              На этом компьютере, без облачной квоты
            </div>
          </div>
        )}

        <div className="sidebar__profile">
          <div className="sidebar__avatar" aria-hidden="true">
            {initials}
          </div>
          {!collapsed ? (
            <div className="sidebar__profile-text">
              <div className="sidebar__profile-name">{displayName}</div>
              <div className="sidebar__profile-caption">этот компьютер</div>
            </div>
          ) : null}
        </div>

        {!collapsed ? (
          <button
            type="button"
            className="sidebar__logout"
            disabled={loggingOut}
            onClick={onLogout}
          >
            <Icon name="log-out" />
            {loggingOut ? "Выход…" : "Выйти"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

const tabBarItems = [
  { to: "/", label: "Главная", icon: "house", end: true },
  { to: "/calendar", label: "Календарь", icon: "calendar", end: false },
  { to: "/archive", label: "Архив", icon: "file-text", end: false },
  { to: "/settings", label: "Настройки", icon: "settings", end: false },
] as const;

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Мобильная навигация">
      {tabBarItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          data-icon={item.icon}
          className={({ isActive }) =>
            isActive ? "tabbar__item tabbar__item--active" : "tabbar__item"
          }
        >
          <Icon name={item.icon} />
          <span className="tabbar__label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

type SessionPayload = SessionInfo & { initials?: string };

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [meetingCount, setMeetingCount] = useState(0);
  const [usedBytes, setUsedBytes] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/session")
      .then(async (res) => {
        if (!res.ok) {
          return;
        }
        setSession((await res.json()) as SessionPayload);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void fetch("/api/meetings")
      .then(async (res) => {
        if (!res.ok) {
          return;
        }
        const body = (await res.json()) as {
          storage?: { meetingCount?: number; usedBytes?: number };
        };
        setMeetingCount(body.storage?.meetingCount ?? 0);
        setUsedBytes(body.storage?.usedBytes ?? 0);
      })
      .catch(() => undefined);
  }, []);

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      navigate("/login", { replace: true });
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <SidebarView
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      displayName={session?.user.displayName}
      initials={session?.initials ?? session?.user.displayName?.slice(0, 1) ?? "П"}
      meetingCount={meetingCount}
      usedBytes={usedBytes}
      loggingOut={loggingOut}
      onLogout={() => {
        void handleLogout();
      }}
    />
  );
}
