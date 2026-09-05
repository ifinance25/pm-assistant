import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CursorCliResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export function resolveCursorAgentBin(): string {
  const explicit = process.env.PM_ASSISTANT_CURSOR_AGENT_BIN?.trim();
  if (explicit) {
    return explicit;
  }
  const home = homedir();
  const candidates = [
    join(home, ".local/bin/agent"),
    "/usr/local/bin/agent",
    "/opt/homebrew/bin/agent",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "agent";
}

export function cursorCliTimeoutMs(): number {
  const raw = process.env.PM_ASSISTANT_CURSOR_AGENT_TIMEOUT_MS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return process.env.VITEST ? 100 : 180_000;
}

export function runCursorCliPrompt(
  prompt: string,
  apiKey: string,
  opts?: { bin?: string; timeoutMs?: number },
): Promise<CursorCliResult> {
  const bin = opts?.bin ?? resolveCursorAgentBin();
  const timeoutMs = opts?.timeoutMs ?? cursorCliTimeoutMs();
  const args = [
    "-p",
    "--trust",
    "--mode",
    "ask",
    "--output-format",
    "text",
    prompt,
  ];
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CURSOR_API_KEY: apiKey,
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}
