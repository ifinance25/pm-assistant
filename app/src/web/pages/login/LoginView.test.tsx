import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginView } from "./LoginView.tsx";

describe("LoginView", () => {
  it("показывает Google, форму и ссылки register/forgot", () => {
    const html = renderToString(
      <MemoryRouter>
        <LoginView
          onGoogle={() => undefined}
          onSubmit={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Войти через Google");
    expect(html).toContain("Почта");
    expect(html).toContain("Пароль");
    expect(html).toContain("Забыли пароль?");
    expect(html).toContain("Зарегистрироваться");
    expect(html).not.toContain("\u2014");
  });

  it("показывает ошибку и состояние отправки", () => {
    const html = renderToString(
      <MemoryRouter>
        <LoginView
          error="Неверный email или пароль"
          submitting
          onGoogle={() => undefined}
          onSubmit={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Неверный email или пароль");
    expect(html).toContain("Вход…");
  });

  it("вызывает onSubmit с email и паролем", () => {
    const onSubmit = vi.fn();
    const html = renderToString(
      <MemoryRouter>
        <LoginView onGoogle={() => undefined} onSubmit={onSubmit} />
      </MemoryRouter>,
    );
    expect(html).toContain('type="submit"');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
