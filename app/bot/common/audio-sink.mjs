/**
 * Приём звука со страницы на стороне Node: общий для ботов всех платформ.
 * Скрипт входа платформы подключает его без правок и отвечает только за клики
 * в своей странице звонка.
 *
 * Порядок работы:
 *   const writer = createAudioWriter(audioPath)
 *   await installAudioCapture(context, writer)   // до context.newPage()
 *   forwardBotConsole(page)
 *   ...вход в звонок...
 *   await armCaptureWatchdog(page)
 *   ...конец звонка...
 *   await stopCaptureAndSave(page, audioPath, writer)  // печатает PM_BOT_AUDIO_SAVED:<путь>
 *
 * Рядом лежит capture-audio.js: так и в app/bot/common, и в каталоге образа,
 * куда Dockerfile копирует оба файла.
 */
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BOT_LOG_PREFIX = "PM_BOT_";
export const CAPTURE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "capture-audio.js");

export function emit(line) {
  console.log(line);
}

/**
 * Пишет куски звука в файл встречи. После close() опоздавший кусок молча
 * отбрасывается (иначе createWriteStream создал бы файл заново и стёр запись),
 * а ошибка потока не роняет процесс бота.
 */
export function createAudioWriter(audioPath) {
  let stream = null;
  let closed = false;
  let dropped = 0;
  return {
    append(b64) {
      if (!audioPath || !b64) {
        return;
      }
      if (closed) {
        dropped += 1;
        return;
      }
      if (!stream) {
        mkdirSync(dirname(audioPath), { recursive: true });
        stream = createWriteStream(audioPath);
        stream.on("error", (err) => {
          emit(`${BOT_LOG_PREFIX}AUDIO_WRITE_ERROR:${err.message}`);
        });
      }
      stream.write(Buffer.from(b64, "base64"));
    },
    close() {
      closed = true;
      return new Promise((resolve) => {
        if (!stream) {
          resolve();
          return;
        }
        const current = stream;
        stream = null;
        current.end(() => {
          if (dropped > 0) {
            emit(`${BOT_LOG_PREFIX}AUDIO_LATE_CHUNKS:${dropped}`);
          }
          resolve();
        });
      });
    },
  };
}

function whichFfmpeg() {
  const candidates = [process.env.FFMPEG_BIN?.trim(), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].filter(Boolean);
  for (const bin of candidates) {
    if (existsSync(bin)) {
      return bin;
    }
  }
  try {
    const found = execFileSync("which", ["ffmpeg"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return found && existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

function runFfmpeg(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/** webm в моно 16 кГц wav, если ffmpeg есть; иначе остаётся webm. */
export async function maybeToWav(webmPath) {
  const bin = whichFfmpeg();
  if (!bin || !existsSync(webmPath)) {
    return webmPath;
  }
  const wavPath = webmPath.replace(/\.webm$/i, ".wav");
  const ok = await runFfmpeg(bin, ["-y", "-i", webmPath, "-ac", "1", "-ar", "16000", wavPath]);
  if (ok && existsSync(wavPath) && statSync(wavPath).size > 64) {
    try {
      unlinkSync(webmPath);
    } catch {
      // исходный webm можно оставить
    }
    return wavPath;
  }
  return webmPath;
}

/** Закрывает файл и печатает `PM_BOT_AUDIO_SAVED:<путь>` (пустой путь, если звука нет). */
export async function finalizeAudio(audioPath, writer) {
  await writer.close();
  if (!audioPath || !existsSync(audioPath) || statSync(audioPath).size < 64) {
    emit(`${BOT_LOG_PREFIX}AUDIO_SAVED:`);
    return null;
  }
  const finalPath = await maybeToWav(audioPath);
  emit(`${BOT_LOG_PREFIX}AUDIO_SAVED:${finalPath}`);
  return finalPath;
}

/** Таймлайн активного спикера рядом с файлом звука: `<id>.speakers.json`. */
export function writeSpeakerTimeline(audioPath, timelineJson) {
  if (!audioPath || !timelineJson) {
    return;
  }
  try {
    const parsed = JSON.parse(timelineJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return;
    }
    const meetingId = basename(audioPath).replace(/\.[^.]+$/, "");
    writeFileSync(join(dirname(audioPath), `${meetingId}.speakers.json`), JSON.stringify(parsed));
  } catch {
    // таймлайн не критичен: расшифровка просто останется без имён
  }
}

/** Впрыскивает перехват звука во все страницы контекста и принимает куски в файл. */
export async function installAudioCapture(context, writer) {
  await context.exposeFunction("pmPushAudio", (b64) => {
    writer.append(String(b64 || ""));
  });
  await context.addInitScript({ path: CAPTURE_SCRIPT });
}

/** Пересылает в stdout строки console страницы с префиксом `PM_BOT_`. */
export function forwardBotConsole(page, onLine = () => {}) {
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes(BOT_LOG_PREFIX)) {
      emit(text);
      onLine(text);
    }
  });
}

/** Вотчдог тишины взводится только после входа: в комнате ожидания тишина законна. */
export async function armCaptureWatchdog(page) {
  if (page.isClosed()) {
    return;
  }
  await page
    .evaluate(() => {
      if (typeof window.__pmCaptureJoined === "function") {
        window.__pmCaptureJoined();
      }
    })
    .catch(() => {});
}

const STOP_CAPTURE_WAIT_MS = 10_000;

/** Останавливает запись в странице, сохраняет таймлайн и файл звука. */
export async function stopCaptureAndSave(page, audioPath, writer) {
  let timelineJson = null;
  if (!page.isClosed()) {
    const stopped = page
      .evaluate(async () => {
        if (typeof window.__pmStopCapture === "function") {
          await window.__pmStopCapture();
        }
        return typeof window.__pmGetSpeakerTimeline === "function" ? window.__pmGetSpeakerTimeline() : null;
      })
      .catch(() => null);
    // У page.evaluate своего таймаута нет: страница может умереть посреди вызова.
    const guard = new Promise((resolve) => {
      setTimeout(() => {
        emit(`${BOT_LOG_PREFIX}CAPTURE_STOP:таймаут страницы ${STOP_CAPTURE_WAIT_MS}мс`);
        resolve(null);
      }, STOP_CAPTURE_WAIT_MS).unref?.();
    });
    timelineJson = await Promise.race([stopped, guard]);
  }
  writeSpeakerTimeline(audioPath, timelineJson);
  return finalizeAudio(audioPath, writer);
}
