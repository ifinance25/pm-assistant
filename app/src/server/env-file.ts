import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function resolveEnvFilePath(): string {
  const explicit = process.env.PM_ASSISTANT_ENV_FILE?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  for (const candidate of [".env", "app/.env"]) {
    if (existsSync(candidate)) {
      return resolve(candidate);
    }
  }
  return resolve(".env");
}

export function upsertEnvVariable(
  key: string,
  value: string,
  filePath = resolveEnvFilePath(),
): void {
  const line = `${key}=${value}`;
  let content = "";
  if (existsSync(filePath)) {
    content = readFileSync(filePath, "utf8");
  }
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  const next = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}${content.endsWith("\n") || content.length === 0 ? "" : "\n"}${line}\n`;
  mkdirIfNeeded(dirname(filePath));
  writeFileSync(filePath, next, "utf8");
  process.env[key] = value;
}

export function removeEnvVariable(
  key: string,
  filePath = resolveEnvFilePath(),
): void {
  if (!existsSync(filePath)) {
    delete process.env[key];
    return;
  }
  const content = readFileSync(filePath, "utf8");
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*\n?`, "m");
  writeFileSync(filePath, content.replace(pattern, ""), "utf8");
  delete process.env[key];
}

function mkdirIfNeeded(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
