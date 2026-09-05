import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RequireAuth } from "./RequireAuth.tsx";

describe("RequireAuth", () => {
  it("не рендерит shell до проверки сессии", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const html = renderToString(
      <MemoryRouter initialEntries={["/"]}>
        <RequireAuth />
      </MemoryRouter>,
    );
    expect(html).toBe("");
    vi.unstubAllGlobals();
  });
});
