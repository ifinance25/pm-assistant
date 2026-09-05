import { readFileSync } from "node:fs";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const botDir = pathJoin(
  dirname(fileURLToPath(import.meta.url)),
  "../../../bot/zoom-web",
);

describe("Zoom-бот не отдаёт звук в эфир", () => {
  it("глушит вывод Chromium, подставляет тихий микрофон и мьютит SDK", () => {
    const joinSrc = readFileSync(pathJoin(botDir, "join.mjs"), "utf8");
    const capture = readFileSync(pathJoin(botDir, "capture-audio.js"), "utf8");
    const sdk = readFileSync(pathJoin(botDir, "public/join.js"), "utf8");
    expect(joinSrc).toContain("--mute-audio");
    expect(joinSrc).toContain("muteBotMicrophone");
    expect(capture).toContain("installSilentMic");
    expect(capture).toContain("el.muted = true");
    expect(sdk).toContain("ZoomMtg.mute({ mute: true })");
    const pkg = JSON.parse(
      readFileSync(pathJoin(botDir, "package.json"), "utf8"),
    ) as { dependencies: { playwright: string } };
    const docker = readFileSync(pathJoin(botDir, "Dockerfile"), "utf8");
    expect(pkg.dependencies.playwright).toBe("1.55.0");
    expect(docker).toContain("playwright:v1.55.0-jammy");
    expect(docker).toContain("npm ci --omit=dev");
  });
});
