import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { SttEngine } from "./index.ts";

const CANDIDATES = [
  process.env.WHISPER_BIN,
  "/opt/homebrew/bin/whisper",
  "/usr/local/bin/whisper",
  "/opt/homebrew/bin/whisper-cli",
  "/usr/local/bin/whisper-cli",
  "/opt/homebrew/bin/whisper.cpp",
].filter((bin): bin is string => Boolean(bin));

export function detectSttEngine(): SttEngine | null {
  for (const bin of CANDIDATES) {
    if (existsSync(bin)) {
      return { kind: "whisper-cli", bin };
    }
  }
  try {
    const found = execFileSync("which", ["whisper"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (found && existsSync(found)) {
      return { kind: "whisper-cli", bin: found };
    }
  } catch {
    return null;
  }
  return null;
}
