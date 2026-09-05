import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import "./login.css";

export type LoginViewProps = {
  error?: string | null;
  googleBusy?: boolean;
  submitting?: boolean;
  onGoogle: () => void;
  onSubmit: (email: string, password: string) => void;
};

export function LoginView({
  error,
  googleBusy = false,
  submitting = false,
  onGoogle,
  onSubmit,
}: LoginViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit(email.trim(), password);
  }

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__brand">
          <div className="login__logo" aria-hidden="true">PM</div>
          <h1 className="login__title">PM Assistant</h1>
          <p className="login__subtitle">Вход в личный кабинет расшифровок</p>
        </div>

        <button
          type="button"
          className="login__google"
          onClick={onGoogle}
          disabled={googleBusy || submitting}
        >
          {googleBusy ? "Перенаправление…" : "Войти через Google"}
        </button>

        <div className="login__divider" role="presentation">
          <span>или</span>
        </div>

        <form className="login__form" onSubmit={handleSubmit}>
          <label className="login__field">
            <span className="login__label">Почта</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              required
            />
          </label>

          <label className="login__field">
            <span className="login__label-row">
              <span className="login__label">Пароль</span>
              <Link className="login__link" to="/forgot-password">
                Забыли пароль?
              </Link>
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
            />
          </label>

          {error ? <p className="login__error" role="alert">{error}</p> : null}

          <button
            type="submit"
            className="login__submit"
            disabled={submitting || googleBusy}
          >
            {submitting ? "Вход…" : "Войти"}
          </button>
        </form>

        <p className="login__register">
          Нет аккаунта?{" "}
          <Link className="login__link" to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  );
}
