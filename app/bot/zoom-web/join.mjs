import { createServer } from "node:http";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { chromium } from "playwright";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");
const captureScript = join(root, "capture-audio.js");
const MEETING_MAX_MS = 4 * 60 * 60 * 1000;

function required(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`нет ${name}`);
  }
  return value;
}

function optional(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function mime(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function startServer(config) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/config.json") {
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify(config));
          return;
        }
        if (url.pathname === "/left") {
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          res.end("left");
          return;
        }
        const file = url.pathname === "/" ? "/join.html" : url.pathname;
        const abs = join(publicDir, file.replace(/^\//, ""));
        if (!abs.startsWith(publicDir)) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        const body = await readFile(abs);
        res.writeHead(200, { "content-type": mime(abs) });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

function emit(line) {
  console.log(line);
}

async function pageText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    chunks.push(await frame.locator("body").innerText().catch(() => ""));
  }
  return chunks.join("\n");
}

function classifyText(combined) {
  if (/ZOOM_BOT_JOINED/.test(combined)) return "joined";
  if (/ZOOM_BOT_WAITING_ROOM/.test(combined)) return "waiting_room";
  if (
    /please wait.*host will let you in/i.test(combined) ||
    /waiting for the host/i.test(combined) ||
    /зал ожидания/i.test(combined) ||
    /host has joined another meeting/i.test(combined)
  ) {
    return "waiting_room";
  }
  const sdkFail = combined.match(/ZOOM_BOT_SDK_FAILED:(.+)/);
  if (sdkFail) return { sdkFailed: sdkFail[1].trim() };
  return null;
}

function meetingEndedText(combined) {
  return (
    /ZOOM_BOT_ENDED/.test(combined) ||
    /this meeting has been ended/i.test(combined) ||
    /the host has ended the meeting/i.test(combined) ||
    /host ended the meeting/i.test(combined) ||
    /you have been removed/i.test(combined) ||
    /встреча завершена/i.test(combined) ||
    /организатор завершил/i.test(combined)
  );
}

async function waitForJoinMarkers(page, timeoutMs, { allowSdkFail = true } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const combined = await pageText(page);
    const classified = classifyText(combined);
    if (classified === "joined") {
      emit("ZOOM_BOT_JOINED");
      return "joined";
    }
    if (classified === "waiting_room") {
      emit("ZOOM_BOT_WAITING_ROOM");
      return "waiting_room";
    }
    if (classified && classified.sdkFailed && allowSdkFail) {
      return classified;
    }
    const mute = page.getByRole("button", {
      name: /^(mute|unmute|микрофон|выкл.*звук)/i,
    });
    if (await mute.first().isVisible().catch(() => false)) {
      emit("ZOOM_BOT_JOINED");
      return "joined";
    }
    await page.waitForTimeout(400);
  }
  return { sdkFailed: "таймаут ожидания входа" };
}

async function clickIfVisible(locator) {
  if (await locator.first().isVisible().catch(() => false)) {
    await locator.first().click({ timeout: 3000 }).catch(() => {});
    return true;
  }
  return false;
}

async function muteBotMicrophone(page) {
  for (const frame of page.frames()) {
    await clickIfVisible(
      frame.getByRole("button", {
        name: /^(mute|mute audio|выключить микрофон|отключить микрофон)$/i,
      }),
    );
  }
  await page
    .evaluate(() => {
      const ZoomMtg = window.ZoomMtg;
      if (!ZoomMtg) {
        return;
      }
      if (typeof ZoomMtg.mute === "function") {
        ZoomMtg.mute({ mute: true });
      }
      if (typeof ZoomMtg.muteVideo === "function") {
        ZoomMtg.muteVideo({ mute: true });
      }
    })
    .catch(() => {});
}

async function dismissOverlays(page) {
  const names = [
    /accept cookies/i,
    /accept all/i,
    /i agree/i,
    /got it/i,
    /принять/i,
    /согласен/i,
  ];
  for (const frame of page.frames()) {
    for (const name of names) {
      await clickIfVisible(frame.getByRole("button", { name }));
    }
  }
}

async function fillNameAndJoin(page, userName) {
  for (const frame of page.frames()) {
    const nameInput = frame.locator(
      '#input-for-name, input[placeholder*="name" i], input[placeholder*="имя" i], input[aria-label*="name" i]',
    );
    if (await nameInput.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nameInput.first().fill(userName);
    }
    const joinBtn = frame.getByRole("button", {
      name: /join meeting|join|войти|подключиться/i,
    });
    if (await clickIfVisible(joinBtn)) {
      return true;
    }
    const fallback = frame.locator(
      "button.preview-join-button, #joinBtn, button.zm-btn--primary",
    );
    if (await clickIfVisible(fallback)) {
      return true;
    }
  }
  return false;
}

async function joinWebClient(page, cfg) {
  const host = cfg.host || "app.zoom.us";
  const pwd = encodeURIComponent(cfg.passWord || "");
  const urls = [
    `https://${host}/wc/join/${cfg.meetingNumber}?fromPWA=1&pwd=${pwd}`,
    `https://app.zoom.us/wc/${cfg.meetingNumber}/join?fromPWA=1&pwd=${pwd}`,
    `https://${host}/wc/${cfg.meetingNumber}/join?fromPWA=1&pwd=${pwd}`,
  ];
  let lastErr = "web client: не удалось открыть";
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(2000);
      await dismissOverlays(page);
      for (const frame of page.frames()) {
        await clickIfVisible(
          frame.getByRole("link", {
            name: /join from your browser|подключ.*браузер/i,
          }),
        );
        await clickIfVisible(
          frame.getByRole("button", {
            name: /join from your browser|подключ.*браузер/i,
          }),
        );
      }
      await page.waitForTimeout(1500);
      await fillNameAndJoin(page, cfg.userName);
      const result = await waitForJoinMarkers(page, 50_000, {
        allowSdkFail: false,
      });
      if (result === "joined" || result === "waiting_room") {
        return result;
      }
      lastErr = result.sdkFailed || lastErr;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastErr.replace(/pwd=[^&\s]+/gi, "pwd=***"));
}

function whichFfmpeg() {
  const candidates = [
    process.env.FFMPEG_BIN?.trim(),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ].filter(Boolean);
  for (const bin of candidates) {
    if (existsSync(bin)) {
      return bin;
    }
  }
  try {
    const found = execFileSync("which", ["ffmpeg"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (found && existsSync(found)) {
      return found;
    }
  } catch {
    return null;
  }
  return null;
}

function runFfmpeg(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function maybeToWav(webmPath) {
  const bin = whichFfmpeg();
  if (!bin || !existsSync(webmPath)) {
    return webmPath;
  }
  const wavPath = webmPath.replace(/\.webm$/i, ".wav");
  const ok = await runFfmpeg(bin, [
    "-y",
    "-i",
    webmPath,
    "-ac",
    "1",
    "-ar",
    "16000",
    wavPath,
  ]);
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

function createAudioWriter(audioPath) {
  let stream = null;
  return {
    append(b64) {
      if (!audioPath || !b64) {
        return;
      }
      if (!stream) {
        mkdirSync(dirname(audioPath), { recursive: true });
        stream = createWriteStream(audioPath);
      }
      stream.write(Buffer.from(b64, "base64"));
    },
    close() {
      return new Promise((resolve) => {
        if (!stream) {
          resolve();
          return;
        }
        stream.end(() => resolve());
        stream = null;
      });
    },
  };
}

async function waitUntilMeetingEnds(page, isEnded) {
  const deadline = Date.now() + MEETING_MAX_MS;
  let muteAttempts = 0;
  while (Date.now() < deadline) {
    if (muteAttempts < 8) {
      await muteBotMicrophone(page);
      muteAttempts += 1;
    }
    if (isEnded()) {
      emit("ZOOM_BOT_ENDED:signal");
      return;
    }
    if (page.isClosed()) {
      emit("ZOOM_BOT_ENDED:page_closed");
      return;
    }
    const url = page.url();
    if (url.includes("/left") || /\/wc\/.*\/leave/.test(url)) {
      emit("ZOOM_BOT_ENDED:leave_url");
      return;
    }
    const combined = await pageText(page).catch(() => "");
    if (meetingEndedText(combined)) {
      emit("ZOOM_BOT_ENDED:ui");
      return;
    }
    await page.waitForTimeout(1000);
  }
  emit("ZOOM_BOT_ENDED:timeout");
}

/**
 * __pmStopCapture (фаза 3.3) сам дожидается requestData()+stop() и заливки
 * последнего куска звука — здесь больше не нужна фиксированная пауза
 * (была временной подпоркой на 1200мс). Заодно забираем таймлайн
 * активного спикера (фаза 4.2), пока страница ещё жива.
 */
async function stopPageCaptureAndCollectTimeline(page) {
  if (page.isClosed()) {
    return null;
  }
  return page
    .evaluate(async () => {
      if (typeof window.__pmStopCapture === "function") {
        await window.__pmStopCapture();
      }
      return typeof window.__pmGetSpeakerTimeline === "function"
        ? window.__pmGetSpeakerTimeline()
        : null;
    })
    .catch(() => null);
}

function writeSpeakerTimeline(audioPath, timelineJson) {
  if (!audioPath || !timelineJson) {
    return;
  }
  try {
    const parsed = JSON.parse(timelineJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return;
    }
    const meetingId = basename(audioPath).replace(/\.[^.]+$/, "");
    const dest = join(dirname(audioPath), `${meetingId}.speakers.json`);
    writeFileSync(dest, JSON.stringify(parsed));
  } catch {
    // таймлайн не критичен: расшифровка (фаза 4) просто останется без имён
  }
}

async function finalizeAudio(audioPath, writer) {
  await writer.close();
  if (!audioPath || !existsSync(audioPath) || statSync(audioPath).size < 64) {
    emit("ZOOM_BOT_AUDIO_SAVED:");
    return null;
  }
  const finalPath = await maybeToWav(audioPath);
  emit(`ZOOM_BOT_AUDIO_SAVED:${finalPath}`);
  return finalPath;
}

async function main() {
  const config = {
    signature: required("ZOOM_SDK_JWT"),
    meetingNumber: required("ZOOM_MEETING_NUMBER"),
    passWord: optional("ZOOM_MEETING_PWD"),
    userName: optional("ZOOM_BOT_NAME", "PM Assistant"),
    sdkKey: optional("ZOOM_CLIENT_ID"),
    host: optional("ZOOM_MEETING_HOST", "app.zoom.us"),
  };
  const audioPath = optional("ZOOM_AUDIO_PATH");
  const writer = createAudioWriter(audioPath);
  let ended = false;
  const onStopSignal = () => {
    ended = true;
  };
  process.on("SIGTERM", onStopSignal);
  process.on("SIGINT", onStopSignal);

  const { server, port } = await startServer(config);
  const headless = optional("ZOOM_BOT_HEADLESS", "0") !== "0";
  const channel = process.env.ZOOM_BOT_CHANNEL?.trim() || (headless ? "" : "chrome");
  const launch = {
    headless,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--mute-audio",
      "--disable-blink-features=AutomationControlled",
      "--lang=en-US",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--auto-select-tab-capture-source-by-title=PM Assistant Zoom",
    ],
  };
  if (channel) {
    launch.channel = channel;
  }
  let browser;
  try {
    browser = await chromium.launch(launch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(`ZOOM_BOT_ERROR:не удалось запустить Chromium: ${message.split("\n")[0]}`);
    server.close();
    process.exit(1);
    return;
  }
  const context = await browser.newContext({
    locale: "en-US",
    permissions: ["microphone", "camera"],
    viewport: { width: 1280, height: 800 },
  });
  await context.exposeFunction("pmPushAudio", (b64) => {
    writer.append(String(b64 || ""));
  });
  await context.exposeFunction("pmBotEvent", (kind) => {
    if (String(kind) === "ended") {
      ended = true;
    }
  });
  if (existsSync(captureScript)) {
    await context.addInitScript({ path: captureScript });
  }
  const page = await context.newPage();
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("ZOOM_BOT_")) {
      emit(text);
      if (text.includes("ZOOM_BOT_ENDED")) {
        ended = true;
      }
    }
  });
  const mode = optional("ZOOM_BOT_MODE", "sdk-then-web");
  const shutdown = async (code) => {
    const timelineJson = await stopPageCaptureAndCollectTimeline(page);
    writeSpeakerTimeline(audioPath, timelineJson);
    await finalizeAudio(audioPath, writer);
    server.close();
    await browser.close().catch(() => {});
    process.exit(code);
  };
  try {
    let joined = false;
    if (mode !== "web") {
      await page.goto(`http://127.0.0.1:${port}/`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const sdk = await waitForJoinMarkers(page, 25_000);
      if (sdk === "joined" || sdk === "waiting_room") {
        joined = true;
      } else {
        emit(`ZOOM_BOT_SDK_FAILED:${sdk.sdkFailed || "unknown"}`);
      }
    }
    if (!joined) {
      const web = await joinWebClient(page, config);
      if (web === "joined" || web === "waiting_room") {
        joined = true;
      }
    }
    if (!joined) {
      emit(
        "ZOOM_BOT_ERROR:не удалось войти ни через Meeting SDK, ни через веб-клиент",
      );
      await shutdown(1);
      return;
    }
    await muteBotMicrophone(page);
    await page.waitForTimeout(800);
    await muteBotMicrophone(page);
    await waitUntilMeetingEnds(page, () => ended);
    await shutdown(0);
  } catch (err) {
    emit(`ZOOM_BOT_ERROR:${err instanceof Error ? err.message : String(err)}`);
    await page.screenshot({ path: "/tmp/zoom-bot-fail.png", fullPage: true }).catch(() => {});
    await shutdown(1);
  }
}

main();
