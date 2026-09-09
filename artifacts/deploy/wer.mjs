#!/usr/bin/env node
// WER (доля неверно распознанных слов) через расстояние Левенштейна.
// Спека: artifacts/2026-09-06-remaining-quality-phases.md, задача 5.1d.
//
// Использование: node wer.mjs [каталог]
// Эталоны (задача пользователя 5.1a-c): <каталог>/reference/<id>.txt
// Гипотеза "до": <каталог>/<id>.ru.txt (уже есть в audio-regression-2026-09-04)
// Гипотеза "после": <каталог>/<id>.after.txt (опционально, из повторного прогона
// с фильтром выдумок / словарём терминов / другой моделью)

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

/** 0 = идеальное совпадение, 1 = ни одно слово не совпало. */
export function wordErrorRate(reference, hypothesis) {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (ref.length === 0) {
    return hyp.length === 0 ? 0 : 1;
  }
  return levenshtein(ref, hyp) / ref.length;
}

async function readIfExists(path) {
  if (!existsSync(path)) {
    return null;
  }
  return (await readFile(path, "utf8")).trim();
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function main() {
  const dir = process.argv[2] ?? "artifacts/audio-regression-2026-09-04";
  const referenceDir = join(dir, "reference");
  const entries = await readdir(dir).catch(() => []);
  const ids = [
    ...new Set(
      entries
        .filter((name) => name.endsWith(".wav"))
        .map((name) => basename(name, ".wav")),
    ),
  ].sort();

  if (ids.length === 0) {
    console.log(`нет .wav в ${dir}`);
    return;
  }

  const rows = [];
  for (const id of ids) {
    const reference = await readIfExists(join(referenceDir, `${id}.txt`));
    if (!reference) {
      rows.push({ id, before: "нет эталона (задача 5.1)", after: "—" });
      continue;
    }
    const before = await readIfExists(join(dir, `${id}.ru.txt`));
    const after = await readIfExists(join(dir, `${id}.after.txt`));
    rows.push({
      id,
      before: before ? formatPercent(wordErrorRate(reference, before)) : "нет файла",
      after: after ? formatPercent(wordErrorRate(reference, after)) : "—",
    });
  }

  const idWidth = Math.max(...rows.map((r) => r.id.length), "файл".length);
  console.log(`${"файл".padEnd(idWidth)}  WER до       WER после`);
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(idWidth)}  ${row.before.padEnd(11)}  ${row.after}`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
