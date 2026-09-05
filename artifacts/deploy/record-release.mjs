#!/usr/bin/env node
/**
 * Пишет секцию CHANGELOG.md для текущей версии app/package.json.
 * Запускается с Mac до rsync (см. sync.sh). На сервере не нужен.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");
const CHANGELOG_PATH = join(PROJECT_ROOT, "CHANGELOG.md");
const STATE_PATH = join(__dirname, "release-state.json");
const APP_PACKAGE = join(PROJECT_ROOT, "app", "package.json");

const GIT_PATHS = [
  "Projects/PM Assistant/app",
  "Projects/PM Assistant/artifacts/deploy",
];

const TREE_IGNORE = new Set([
  "artifacts/deploy/release-state.json",
  "artifacts/deploy/record-release.mjs",
  "artifacts/deploy/record-release.sh",
  "artifacts/deploy/record-release.test.mjs",
]);

const CATEGORY_ORDER = [
  ["added", "Добавлено"],
  ["changed", "Изменено"],
  ["fixed", "Исправлено"],
  ["removed", "Удалено"],
  ["files", "Состав выкладки"],
];

const EMPTY_CATS = () => ({
  added: [],
  changed: [],
  fixed: [],
  removed: [],
  files: [],
});

export function stripConventional(subject) {
  return subject
    .replace(
      /^(feat|fix|docs|refactor|chore|test|style|perf|build|ci)(\([^)]+\))?:\s*/i,
      "",
    )
    .trim();
}

export function categorizeSubject(subject) {
  const m = subject.match(
    /^(feat|fix|docs|refactor|chore|test|style|perf|build|ci)(\([^)]+\))?:/i,
  );
  const type = (m?.[1] || "").toLowerCase();
  if (type === "feat") return "added";
  if (type === "fix") return "fixed";
  if (type === "docs" || type === "refactor" || type === "chore") return "changed";
  if (type === "perf" || type === "build" || type === "ci" || type === "test" || type === "style") {
    return "changed";
  }
  return "changed";
}

export function parsePorcelain(text) {
  const lines = [];
  for (const raw of text.split("\n")) {
    if (!raw) continue;
    const path = raw.slice(3).replace(/^"|"$/g, "").replace(/\\ /g, " ");
    const rel = path.replace(/^Projects\/PM Assistant\//, "");
    if (TREE_IGNORE.has(rel)) continue;
    lines.push(`${raw.slice(0, 2)} ${rel}`);
  }
  return lines.sort();
}

export function treeDiff(prev, now) {
  const prevSet = new Set(prev);
  return now.filter((line) => !prevSet.has(line));
}

export function groupPaths(relPaths) {
  const buckets = new Map();
  for (const p of relPaths) {
    const parts = p.split("/");
    let key;
    if (parts.length >= 4) key = parts.slice(0, 4).join("/");
    else if (parts.length >= 3) key = parts.slice(0, 3).join("/");
    else key = parts.slice(0, -1).join("/") || p;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));
}

export function extractUnreleased(markdown) {
  const m = markdown.match(
    /<!-- unreleased:start -->\n([\s\S]*?)\n<!-- unreleased:end -->/,
  );
  if (!m) return { body: "", categories: EMPTY_CATS() };
  return { body: m[1].trim(), categories: parseCategoryBlock(m[1]) };
}

export function parseCategoryBlock(body) {
  const cats = EMPTY_CATS();
  let current = "changed";
  for (const line of body.split("\n")) {
    const heading = line.match(/^### (.+)\s*$/);
    if (heading) {
      const title = heading[1].trim();
      const found = CATEGORY_ORDER.find(([, ru]) => ru === title);
      current = found ? found[0] : "changed";
      continue;
    }
    const item = line.match(/^- (.+)$/);
    if (item) cats[current].push(item[1].trim());
  }
  return cats;
}

export function mergeCategories(a, b) {
  const out = EMPTY_CATS();
  for (const key of Object.keys(out)) {
    const seen = new Set();
    for (const item of [...(a[key] || []), ...(b[key] || [])]) {
      if (seen.has(item)) continue;
      seen.add(item);
      out[key].push(item);
    }
  }
  return out;
}

export function categoriesEmpty(cats) {
  return Object.values(cats).every((arr) => arr.length === 0);
}

export function renderCategories(cats) {
  const parts = [];
  for (const [key, ru] of CATEGORY_ORDER) {
    if (!cats[key]?.length) continue;
    parts.push(`### ${ru}`, "", ...cats[key].map((item) => `- ${item}`), "");
  }
  return parts.join("\n").trimEnd();
}

export function setUnreleased(markdown, inner) {
  const block = `<!-- unreleased:start -->\n\n${inner ? `${inner}\n\n` : ""}<!-- unreleased:end -->`;
  if (/<!-- unreleased:start -->[\s\S]*?<!-- unreleased:end -->/.test(markdown)) {
    return markdown.replace(
      /<!-- unreleased:start -->[\s\S]*?<!-- unreleased:end -->/,
      block,
    );
  }
  throw new Error("в CHANGELOG.md нет маркеров unreleased:start / unreleased:end");
}

export function renderVersionSection(version, date, deployLine, cats) {
  const body = renderCategories(cats);
  return [
    `## [${version}] - ${date}`,
    "",
    `_${deployLine}_`,
    "",
    body || "Новых пунктов с прошлой записи нет: версия в package.json поднята.",
    "",
  ].join("\n");
}

export function insertVersionSection(markdown, section) {
  const marker = "<!-- unreleased:end -->";
  const idx = markdown.indexOf(marker);
  if (idx < 0) throw new Error("нет маркера unreleased:end");
  const at = idx + marker.length;
  return `${markdown.slice(0, at)}\n\n${section}${markdown.slice(at)}`;
}

export function mergeDeployLine(existing, extra) {
  const m = existing.match(/^_Выкладки: (.+)_$/);
  if (!m) return `_${extra}_`;
  if (m[1].includes(extra.replace(/^Выкладки: /, ""))) return existing;
  return `_Выкладки: ${m[1]}; ${extra.replace(/^Выкладки: /, "")}_`;
}

export function mergeVersionSection(markdown, version, deployLine, cats) {
  const re = new RegExp(
    `(## \\[${escapeRe(version)}\\][^\\n]*\\n\\n)(_[^\\n]+_\\n\\n)([\\s\\S]*?)(?=\\n## \\[|$)`,
  );
  const m = markdown.match(re);
  if (!m) return insertVersionSection(markdown, renderVersionSection(version, "", deployLine, cats));
  const oldCats = parseCategoryBlock(m[3]);
  const merged = mergeCategories(oldCats, cats);
  const newDeploy = mergeDeployLine(m[2].trim(), deployLine);
  const body = renderCategories(merged);
  const replacement = `${m[1]}${newDeploy}\n\n${body}\n\n`;
  return markdown.replace(re, replacement);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasVersionSection(markdown, version) {
  return markdown.includes(`## [${version}]`);
}

export function applyRelease(markdown, { version, date, deployLine, categories }) {
  const unreleased = extractUnreleased(markdown);
  const cats = mergeCategories(unreleased.categories, categories);
  let next = setUnreleased(markdown, "");
  if (hasVersionSection(next, version)) {
    next = mergeVersionSection(next, version, deployLine, cats);
  } else {
    next = insertVersionSection(
      next,
      renderVersionSection(version, date, deployLine, cats),
    );
  }
  return next;
}

function gitRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  }).trim();
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

export function collectCommits(root, sinceSha) {
  const range = sinceSha ? `${sinceSha}..HEAD` : "HEAD";
  const args = ["log", range, "--pretty=format:%h|%s", "--"];
  args.push(...GIT_PATHS);
  let out;
  try {
    out = git(args, root).trim();
  } catch {
    return [];
  }
  if (!out) return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const i = line.indexOf("|");
    return { sha: line.slice(0, i), subject: line.slice(i + 1) };
  });
}

export function commitsToCategories(commits) {
  const cats = EMPTY_CATS();
  for (const c of commits) {
    const key = categorizeSubject(c.subject);
    cats[key].push(`${stripConventional(c.subject)} (\`${c.sha}\`)`);
  }
  return cats;
}

export function collectTree(root) {
  const out = git(
    ["status", "--porcelain", "-uall", "--", ...GIT_PATHS],
    root,
  );
  return parsePorcelain(out);
}

export function treeToFileCategories(newLines) {
  const cats = EMPTY_CATS();
  const paths = newLines.map((line) => line.slice(3));
  for (const [dir, count] of groupPaths(paths)) {
    cats.files.push(`\`${dir}\`: ${filesRu(count)}`);
  }
  return cats;
}

export function filesRu(n) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} файл`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} файла`;
  return `${n} файлов`;
}

function tbilisiDate() {
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tbilisi" });
  return { date: stamp.slice(0, 10), datetime: stamp.replace("T", " ").slice(0, 16) };
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hostLabel() {
  const host = process.env.PM_ASSISTANT_HOST || "ubuntu@16.171.52.89";
  return host.replace(/^[^@]+@/, "");
}

export function shouldSkip({ version, state, commits, treeNew, unreleasedEmpty, versionSectionExists }) {
  if (version !== state.version) return false;
  if (!versionSectionExists) return false;
  if (commits.length) return false;
  if (treeNew.length) return false;
  if (!unreleasedEmpty) return false;
  return true;
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const seed = process.argv.includes("--seed-state");
  if (!seed && !existsSync(STATE_PATH)) {
    throw new Error("нет release-state.json: сначала node record-release.mjs --seed-state --version 0.1.0");
  }
  const root = gitRoot();
  const pkg = JSON.parse(readFileSync(APP_PACKAGE, "utf8"));
  const version = argValue("--version") || pkg.version;
  const head = git(["rev-parse", "--short", "HEAD"], root).trim();
  const tree = collectTree(root);
  const state = readJson(STATE_PATH, { version: null, sha: null, tree: [] });

  if (seed) {
    const payload = {
      version,
      sha: git(["rev-parse", "HEAD"], root).trim(),
      shaShort: head,
      deployed_at: tbilisiDate().datetime,
      tree,
    };
    if (!dry) writeJson(STATE_PATH, payload);
    console.log(`[release] state ${version} @ ${head} (${tree.length} путей)`);
    return;
  }

  if (process.env.SKIP_RELEASE_NOTES === "1") {
    console.log("[release] пропуск (SKIP_RELEASE_NOTES=1)");
    return;
  }

  if (!existsSync(CHANGELOG_PATH)) {
    throw new Error(`нет ${CHANGELOG_PATH}`);
  }

  const markdown = readFileSync(CHANGELOG_PATH, "utf8");
  const commits = collectCommits(root, state.sha);
  const treeNew = treeDiff(state.tree || [], tree);
  const unreleased = extractUnreleased(markdown);
  const skip = shouldSkip({
    version,
    state,
    commits,
    treeNew,
    unreleasedEmpty: !unreleased.body,
    versionSectionExists: hasVersionSection(markdown, version),
  });

  if (skip) {
    console.log(`[release] ${version} без изменений, CHANGELOG не трогаем`);
    return;
  }

  const { date, datetime } = tbilisiDate();
  const deployLine = `Выкладки: ${datetime} (\`${head}\`) → EC2 \`${hostLabel()}\``;
  const categories = mergeCategories(
    commitsToCategories(commits),
    treeToFileCategories(treeNew),
  );

  const next = applyRelease(markdown, { version, date, deployLine, categories });
  const payload = {
    version,
    sha: git(["rev-parse", "HEAD"], root).trim(),
    shaShort: head,
    deployed_at: datetime,
    tree,
  };

  if (dry) {
    console.log("[release] dry-run");
    console.log(renderVersionSection(version, date, deployLine, mergeCategories(unreleased.categories, categories)));
    return;
  }

  writeFileSync(CHANGELOG_PATH, next);
  writeJson(STATE_PATH, payload);
  console.log(`[release] записана ${version} (${commits.length} коммитов, ${treeNew.length} путей)`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`[release] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
