import { describe, expect, it } from "vitest";
import { INTEGRATIONS_REDIRECT } from "./App.tsx";

describe("App routes", () => {
  it("редиректит /integrations на /settings#integrations", () => {
    expect(INTEGRATIONS_REDIRECT).toBe("/settings#integrations");
  });
});
