import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  readSidebarCollapsed,
  routePrefersCollapsedSidebar,
  SIDEBAR_COLLAPSED_KEY,
  writeSidebarCollapsed,
} from "./sidebar-utils.ts";
import { Sidebar } from "./Sidebar.tsx";

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

  return (
    <div className={collapsed ? "shell shell--sidebar-collapsed" : "shell"}>
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <div className="workspace">
        <main className="workspace__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
