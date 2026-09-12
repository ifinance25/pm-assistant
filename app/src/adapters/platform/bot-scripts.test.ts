import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Код Zoom-бота лежит в app/bot: это отдельный пакет со своим node_modules и
 * Docker-образом, он не входит ни в tsconfig (`include: ["src"]`), ни в сборку
 * Vite. До этого теста ошибка разбора в нём находилась только на живом звонке.
 * Линтер теперь тоже смотрит на bot/** (biome.json).
 */
const botDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../bot/zoom-web",
);

const scripts = ["join.mjs", "capture-audio.js"];

describe("скрипты Zoom-бота", () => {
  it("лежат на месте", () => {
    for (const name of scripts) {
      expect(existsSync(join(botDir, name))).toBe(true);
    }
  });

  for (const name of scripts) {
    it(`${name}: разбирается без синтаксических ошибок`, () => {
      expect(() =>
        execFileSync(process.execPath, ["--check", join(botDir, name)], {
          stdio: ["ignore", "ignore", "pipe"],
        }),
      ).not.toThrow();
    });
  }

  it("capture-audio.js: заливка кусков звука выстроена в очередь", () => {
    const source = readFileSync(join(botDir, "capture-audio.js"), "utf8");
    // Без цепочки ожидание в __pmStopCapture дожидалось бы только последнего
    // куска, а порядок записи в файл не был бы гарантирован.
    expect(source).toContain("mixer.pendingPush.then(() => pushBlob(blob))");
    // Вотчдог тишины взводится только после входа в звонок.
    expect(source).toContain("window.__pmCaptureJoined");
    // У остановки записи есть предел ожидания.
    expect(source).toContain("STOP_TIMEOUT_MS");
  });

  it("join.mjs: писатель звука не пересоздаёт файл после закрытия", () => {
    const source = readFileSync(join(botDir, "join.mjs"), "utf8");
    expect(source).toContain("ZOOM_BOT_AUDIO_LATE_CHUNKS");
    expect(source).toContain("armCaptureWatchdog");
    expect(source).toContain("STOP_CAPTURE_WAIT_MS");
  });
});
