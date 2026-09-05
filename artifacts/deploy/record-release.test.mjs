import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyRelease,
  categorizeSubject,
  categoriesEmpty,
  extractUnreleased,
  groupPaths,
  mergeCategories,
  parsePorcelain,
  shouldSkip,
  stripConventional,
  treeDiff,
} from "./record-release.mjs";

describe("stripConventional", () => {
  it("снимает префикс feat(scope)", () => {
    assert.equal(
      stripConventional("feat(pm-assistant): T01 каркас"),
      "T01 каркас",
    );
  });
});

describe("categorizeSubject", () => {
  it("feat → added, fix → fixed", () => {
    assert.equal(categorizeSubject("feat(pm-assistant): x"), "added");
    assert.equal(categorizeSubject("fix: y"), "fixed");
    assert.equal(categorizeSubject("без префикса"), "changed");
  });
});

describe("porcelain and treeDiff", () => {
  it("режет префикс vault и ignore-файлы", () => {
    const parsed = parsePorcelain(
      [
        " M Projects/PM Assistant/app/package.json",
        "?? Projects/PM Assistant/artifacts/deploy/release-state.json",
        "?? Projects/PM Assistant/app/src/shared/version.ts",
      ].join("\n"),
    );
    assert.deepEqual(parsed, [" M app/package.json", "?? app/src/shared/version.ts"]);
    assert.deepEqual(treeDiff([" M app/package.json"], parsed), [
      "?? app/src/shared/version.ts",
    ]);
  });
});

describe("groupPaths", () => {
  it("группирует по 4 сегментам", () => {
    const g = groupPaths([
      "app/src/server/auth/session.ts",
      "app/src/server/auth/password.ts",
      "app/package.json",
    ]);
    assert.deepEqual(g, [
      ["app", 1],
      ["app/src/server/auth", 2],
    ]);
  });
});

describe("changelog apply", () => {
  const template = `# История

## [Unreleased]

<!-- unreleased:start -->

### Добавлено

- Вход

<!-- unreleased:end -->

## [0.1.0] - 2026-09-04

_Выкладки: 2026-09-04 (\`abc\`)_

### Добавлено

- Каркас
`;

  it("переносит Unreleased в новую версию и очищает маркер", () => {
    const next = applyRelease(template, {
      version: "0.2.0",
      date: "2026-09-05",
      deployLine: "Выкладки: 2026-09-05 01:30 (`def`) → EC2 `16.171.52.89`",
      categories: { added: [], changed: [], fixed: [], removed: [], files: [] },
    });
    assert.match(next, /## \[0\.2\.0\] - 2026-09-05/);
    assert.match(next, /- Вход/);
    const u = extractUnreleased(next);
    assert.equal(u.body, "");
    assert.match(next, /## \[0\.1\.0\]/);
  });

  it("дедуп при повторной выкладке той же версии", () => {
    const first = applyRelease(template, {
      version: "0.2.0",
      date: "2026-09-05",
      deployLine: "Выкладки: 2026-09-05 01:30 (`def`) → EC2 `x`",
      categories: {
        added: ["Сайдбар"],
        changed: [],
        fixed: [],
        removed: [],
        files: [],
      },
    });
    const second = applyRelease(first, {
      version: "0.2.0",
      date: "2026-09-06",
      deployLine: "Выкладки: 2026-09-06 12:00 (`ghi`) → EC2 `x`",
      categories: {
        added: ["Сайдбар"],
        changed: [],
        fixed: [],
        removed: [],
        files: ["`app/src/web`: 2 файла"],
      },
    });
    const added = second.match(/### Добавлено\n\n([\s\S]*?)\n\n### /);
    assert.ok(added);
    const bullets = added[1].split("\n").filter((l) => l.startsWith("- "));
    assert.equal(bullets.filter((l) => l.includes("Сайдбар")).length, 1);
    assert.match(second, /16:00|12:00/);
    assert.match(second, /`app\/src\/web`: 2 файла/);
  });
});

describe("shouldSkip", () => {
  it("пропускает повтор той же версии без дельты", () => {
    assert.equal(
      shouldSkip({
        version: "0.2.0",
        state: { version: "0.2.0" },
        commits: [],
        treeNew: [],
        unreleasedEmpty: true,
        versionSectionExists: true,
      }),
      true,
    );
    assert.equal(
      shouldSkip({
        version: "0.2.0",
        state: { version: "0.1.0" },
        commits: [],
        treeNew: [],
        unreleasedEmpty: true,
        versionSectionExists: false,
      }),
      false,
    );
  });
});

describe("mergeCategories", () => {
  it("пустой набор остаётся пустым", () => {
    const a = mergeCategories(
      { added: ["A"], changed: [], fixed: [], removed: [], files: [] },
      { added: ["A", "B"], changed: [], fixed: [], removed: [], files: [] },
    );
    assert.deepEqual(a.added, ["A", "B"]);
    assert.equal(categoriesEmpty({ added: [], changed: [], fixed: [], removed: [], files: [] }), true);
  });
});
