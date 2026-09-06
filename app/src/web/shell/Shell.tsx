import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  readSidebarCollapsed,
  routeLocksWorkspace,
  routePrefersCollapsedSidebar,
  SIDEBAR_COLLAPSED_KEY,
  writeSidebarCollapsed,
} from "./sidebar-utils.ts";
import { Sidebar, TabBar } from "./Sidebar.tsx";

export function Shell() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() =>
    readSidebarCollapsed(location.pathname),
  );

  useEffect(() => {
    setCollapsed(readSidebarCollapsed(location.pathname));
  }, [location.pathname]);

  function toggleCollapsed(): void {
    setCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  }

  useEffect(() => {
    if (routePrefersCollapsedSidebar(location.pathname)) {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === null) {
        setCollapsed(true);
      }
    }
  }, [location.pathname]);

  const lockWorkspace = routeLocksWorkspace(location.pathname);
  const shellClass = [
    "shell",
    collapsed ? "shell--sidebar-collapsed" : "",
    lockWorkspace ? "shell--lock" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <TabBar />
      <div className="workspace">
        <main
          className={
            lockWorkspace
              ? "workspace__main workspace__main--lock"
              : "workspace__main"
          }
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
