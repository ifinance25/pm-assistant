import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

type AuthState = "loading" | "authed" | "guest";

export function RequireAuth() {
  const location = useLocation();
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    void fetch("/api/auth/session")
      .then((res) => {
        setState(res.ok ? "authed" : "guest");
      })
      .catch(() => {
        setState("guest");
      });
  }, []);

  if (state === "loading") {
    return null;
  }

  if (state === "guest") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
