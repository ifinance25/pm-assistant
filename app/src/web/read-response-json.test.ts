import { describe, expect, it } from "vitest";
import { readResponseJson } from "./read-response-json.ts";

describe("readResponseJson", () => {
  it("на пустом теле ошибки не бросает Unexpected end of JSON input", async () => {
    const res = new Response("", { status: 405, statusText: "Method Not Allowed" });
    try {
      await readResponseJson(res);
      throw new Error("ожидали исключение");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/пустой ответ/);
      expect((err as Error).message).not.toMatch(/Unexpected end of JSON/);
    }
  });

  it("на пустом успешном ответе даёт понятную ошибку", async () => {
    const res = new Response("", { status: 200 });
    await expect(readResponseJson(res)).rejects.toThrow(/пустой ответ/);
  });

  it("читает JSON-тело", async () => {
    const res = new Response(JSON.stringify({ error: "нужно имя проекта" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    await expect(readResponseJson<{ error: string }>(res)).resolves.toEqual({
      error: "нужно имя проекта",
    });
  });
});
