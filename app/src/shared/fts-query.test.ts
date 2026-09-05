import { describe, expect, it } from "vitest";
import { toFtsMatchQuery } from "./fts-query.ts";

describe("toFtsMatchQuery", () => {
  it("строит префиксный AND-запрос по словам", () => {
    expect(toFtsMatchQuery("релиз")).toBe('"релиз"*');
    expect(toFtsMatchQuery("API gateway")).toBe('"API"* AND "gateway"*');
  });

  it("экранирует кавычки", () => {
    expect(toFtsMatchQuery('foo "bar"')).toBe('"foo"* AND """bar"""*');
  });

  it("возвращает null для пустого запроса", () => {
    expect(toFtsMatchQuery("   ")).toBeNull();
  });
});
