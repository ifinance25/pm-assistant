import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { SessionInfo } from "../../../shared/types.ts";
import { LoginView } from "./LoginView.tsx";

const ERROR_MESSAGES: Record<string, string> = {
  google: "Не удалось войти через Google. Попробуйте снова или используйте почту и пароль.",
  invalid: "Неверный email или пароль",
};

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    const queryError = params.get("error");
    if (queryError) {
      setError(ERROR_MESSAGES[queryError] ?? "Ошибка входа");
    }
  }, [params]);

  useEffect(() => {
    void fetch("/api/auth/session")
      .then(async (res) => {
        if (res.ok) {
          navigate("/", { replace: true });
        }
      })
      .catch(() => undefined);
  }, [navigate]);

  async function handleSubmit(email: string, password: string): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? ERROR_MESSAGES.invalid);
        return;
      }
      await res.json() as SessionInfo;
      navigate("/", { replace: true });
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setSubmitting(false);
    }
  }

  function handleGoogle(): void {
    setGoogleBusy(true);
    window.location.href = "/api/auth/google/start";
  }

  return (
    <LoginView
      error={error}
      submitting={submitting}
      googleBusy={googleBusy}
      onSubmit={(email, password) => {
        void handleSubmit(email, password);
      }}
      onGoogle={handleGoogle}
    />
  );
}
