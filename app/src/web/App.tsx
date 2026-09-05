import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ArchivePlaceholder } from "./pages/archive/ArchivePlaceholder.tsx";
import { CalendarPlaceholder } from "./pages/calendar/CalendarPlaceholder.tsx";
import { Home } from "./pages/home/Home.tsx";
import { AuthStubPage } from "./pages/login/AuthStubPage.tsx";
import { LoginPage } from "./pages/login/Login.tsx";
import { MeetingPage } from "./pages/meeting/MeetingPage.tsx";
import { SettingsPlaceholder } from "./pages/settings/SettingsPlaceholder.tsx";
import { RequireAuth } from "./shell/RequireAuth.tsx";
import { Shell } from "./shell/Shell.tsx";

export const INTEGRATIONS_REDIRECT = "/settings#integrations";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/register"
          element={
            <AuthStubPage
              title="Регистрация"
              body="Регистрация появится в фазе 1.5. Пока используйте вход через Google или учётную запись администратора."
            />
          }
        />
        <Route
          path="/forgot-password"
          element={
            <AuthStubPage
              title="Восстановление пароля"
              body="Сброс пароля появится в фазе 1.5. Обратитесь к администратору или войдите через Google."
            />
          }
        />
        <Route
          path="/integrations"
          element={<Navigate to={INTEGRATIONS_REDIRECT} replace />}
        />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route path="/" element={<Home />} />
            <Route path="/calendar" element={<CalendarPlaceholder />} />
            <Route path="/archive" element={<ArchivePlaceholder />} />
            <Route path="/settings" element={<SettingsPlaceholder />} />
            <Route path="/meetings/:id" element={<MeetingPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
