/**
 * Бот Google Meet в контейнере: входит гостем, ждёт допуска, пишет звук всех
 * участников общим перехватом (bot/common) и печатает строки для рантайма:
 *
 *   PM_BOT_WAITING_ROOM:ждёт допуска <n> с   экран допуска, повторяется раз в 30 с
 *   PM_BOT_JOINED                            бот в звонке
 *   PM_BOT_ENDED:<ui|signal|page_closed|timeout|error>
 *   PM_BOT_ERROR:<текст для пользователя>    отказ до входа; перед ней PM_BOT_FAIL:<код> в журнал
 *   PM_BOT_AUDIO_SAVED:<путь>                только после входа, печатает bot/common/audio-sink.mjs
 *
 * Звонок заканчивается только экраном конца звонка, сигналом или пределом 4 часа.
 * Код выхода: 0 звонок закончился штатно, 1 сбой.
 *
 * Что на экране, решает meet-state.mjs; здесь только клики.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  abandonAudio,
  callOver,
  classifyMeetPage,
  containerDeadlines,
  endedLine,
  failScreenshotPath,
  failureLines,
  joinedLine,
  readMeetConfig,
  waitingRoomLine,
} from "./meet-state.mjs";

const STARTED_AT = Date.now();
const root = dirname(fileURLToPath(import.meta.url));
// В образе общий код лежит рядом (Dockerfile), в дереве исходников в ../common.
const sink = await import(existsSync(join(root, "audio-sink.mjs")) ? "./audio-sink.mjs" : "../common/audio-sink.mjs");

const POLL_MS = 1_000;
const ASK_RETRY_MS = 5_000;
const WAITING_LOG_EVERY_MS = 30_000;
const LEAVE_BUTTON = /leave call|покинуть (?:видео)?встречу|выйти из (?:видео)?встречи|завершить (?:вызов|звонок)/i;

const emit = (line) => console.log(line);

async function clickVisible(locator) {
  const all = await locator.all().catch(() => []);
  let clicked = false;
  for (const item of all) {
    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout: 3_000 }).catch(() => {});
      clicked = true;
    }
  }
  return clicked;
}

/** Согласие на cookies и подсказки поверх экрана. Отказ от cookies раньше согласия. */
async function dismissOverlays(page) {
  const names = [
    /^reject all$/i,
    /^accept all$/i,
    /^continue without (?:microphone|camera|microphone and camera)$/i,
    /^got it$/i,
    /^dismiss$/i,
    /^отклонить все$/i,
    /^принять все$/i,
    /^продолжить без (?:микрофона|камеры)/i,
    /^понятно$/i,
  ];
  for (const name of names) {
    await clickVisible(page.getByRole("button", { name }));
  }
}

/**
 * Микрофон и камера выключены кнопками Meet. Звук микрофона и так тишина:
 * capture-audio.js подменяет getUserMedia, кнопка нужна, чтобы участники видели.
 */
async function turnOffDevices(page) {
  await clickVisible(
    page.getByRole("button", { name: /turn off (?:microphone|camera)|выключить (?:микрофон|камеру)/i }),
  );
}

async function askToJoin(page, botName) {
  await dismissOverlays(page);
  await turnOffDevices(page);
  const nameInput = page
    .locator('input[aria-label*="name" i], input[placeholder*="name" i], input[aria-label*="имя" i], input[placeholder*="имя" i]')
    .first();
  if (await nameInput.isVisible().catch(() => false)) {
    if ((await nameInput.inputValue().catch(() => "")) !== botName) {
      await nameInput.fill(botName).catch(() => {});
    }
  }
  const joinButton = page.getByRole("button", {
    name: /ask to join|join now|попросить (?:разрешения|войти)|^присоединиться/i,
  });
  if (await clickVisible(joinButton)) {
    return true;
  }
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.press("Enter").catch(() => {});
    return true;
  }
  return false;
}

/** До входа: бот в звонке, если видна кнопка выхода из звонка. */
async function inCall(page) {
  return page.getByRole("button", { name: LEAVE_BUTTON }).first().isVisible().catch(() => false);
}

/** После входа: кнопка выхода есть в странице, пусть и спрятана вместе с панелью. */
async function leaveButtonInPage(page) {
  const count = await page
    .getByRole("button", { name: LEAVE_BUTTON, includeHidden: true })
    .count()
    .catch(() => 0);
  return count > 0;
}

async function readScreen(page) {
  if (page.isClosed()) {
    return { url: "", text: "", inCall: false };
  }
  return {
    url: page.url(),
    text: await page.locator("body").innerText({ timeout: 2_000 }).catch(() => ""),
    inCall: await inCall(page),
  };
}

async function launchBrowser(config) {
  const args = [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--mute-audio",
    "--disable-blink-features=AutomationControlled",
    "--lang=en-US",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    // Заголовок вкладки звонка: «Meet - abc-defg-hij».
    "--auto-select-tab-capture-source-by-title=Meet",
  ];
  // Полный Chromium в режиме без окна ближе к обычному браузеру, чем headless shell.
  const channels = config.channel ? [config.channel] : config.headless ? ["chromium", ""] : ["chrome", ""];
  let lastError = null;
  for (const channel of channels) {
    try {
      return await chromium.launch({
        headless: config.headless,
        args,
        ignoreDefaultArgs: ["--enable-automation"],
        ...(channel ? { channel } : {}),
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function main() {
  const config = readMeetConfig(process.env);
  const deadlines = containerDeadlines(config.timeouts);
  const writer = sink.createAudioWriter(config.audioPath);
  let stopRequested = false;
  process.on("SIGTERM", () => {
    stopRequested = true;
  });
  process.on("SIGINT", () => {
    stopRequested = true;
  });

  let browser = null;
  let page = null;
  let finished = false;
  /** Только после входа: звук сохраняется, печатается PM_BOT_AUDIO_SAVED. */
  const finishCall = async (code, { leave = false } = {}) => {
    if (finished) {
      return;
    }
    finished = true;
    // Сначала звук, потом выход из звонка: экран «вы покинули встречу» может
    // оказаться новой страницей, и перехват в ней начал бы запись заново.
    await sink.stopCaptureAndSave(page, config.audioPath, writer);
    if (leave && !page.isClosed()) {
      await page.getByRole("button", { name: LEAVE_BUTTON }).first().click({ timeout: 3_000 }).catch(() => {});
    }
    await browser?.close().catch(() => {});
    process.exit(code);
  };
  /** До входа: файла звука не остаётся, PM_BOT_AUDIO_SAVED не печатается. */
  const abandon = async (lines) => {
    if (finished) {
      return;
    }
    finished = true;
    for (const line of lines) {
      emit(line);
    }
    await abandonAudio(config.audioPath, writer);
    await browser?.close().catch(() => {});
    process.exit(1);
  };
  const fail = async (code, detail = "") => {
    const [failLine, ...rest] = failureLines(code, detail);
    emit(failLine);
    const shot = failScreenshotPath(config.audioPath);
    if (page && shot) {
      const saved = await page
        .screenshot({ path: shot, fullPage: true })
        .then(() => true)
        .catch(() => false);
      if (saved) {
        emit(`PM_BOT_SCREENSHOT:${shot}`);
      }
    }
    await abandon(rest);
  };

  if (!config.meetingUrl) {
    await fail("bad_config");
    return;
  }

  try {
    browser = await launchBrowser(config);
  } catch (err) {
    await fail("browser_failed", String(err instanceof Error ? err.message : err).split("\n")[0]);
    return;
  }

  let joined = false;
  try {
    const version = browser.version();
    const context = await browser.newContext({
      locale: "en-US",
      permissions: ["microphone", "camera"],
      viewport: { width: 1280, height: 800 },
      // Без «HeadlessChrome» в строке браузера: Meet не пускает неизвестные браузеры.
      userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
    });
    await sink.installAudioCapture(context, writer);
    page = await context.newPage();
    sink.forwardBotConsole(page);

    await page.goto(config.meetingUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((err) => {
      emit(`PM_BOT_STEP:страница Meet не открылась с первого раза: ${String(err?.message ?? err).split("\n")[0]}`);
    });

    let lastAskAt = 0;
    let waitingSince = null;
    let lastWaitingLogAt = 0;
    while (!joined) {
      if (stopRequested) {
        emit(endedLine("signal"));
        await fail("stopped");
        return;
      }
      const now = Date.now();
      const state = classifyMeetPage(await readScreen(page));
      if (state === "joined") {
        joined = true;
        break;
      }
      if (state === "sign_in_required" || state === "denied" || state === "meeting_not_found") {
        await fail(state);
        return;
      }
      if (state === "ended") {
        await fail("meeting_not_found");
        return;
      }
      if (state === "waiting_room") {
        if (waitingSince === null) {
          waitingSince = now;
        }
        if (now - lastWaitingLogAt >= WAITING_LOG_EVERY_MS) {
          lastWaitingLogAt = now;
          emit(waitingRoomLine((now - waitingSince) / 1000));
        }
        if (now - waitingSince >= deadlines.waitingRoomMs) {
          await fail("waiting_room_timeout");
          return;
        }
      } else if (state === "no_response" || now - lastAskAt >= ASK_RETRY_MS) {
        // Meet сам снимает запрос, если долго не отвечают: просим снова, пока идут 10 минут.
        if (await askToJoin(page, config.botName)) {
          lastAskAt = now;
        }
      }
      if (waitingSince === null && now - STARTED_AT >= deadlines.joinMs) {
        await fail("join_timeout");
        return;
      }
      if (waitingSince !== null && state !== "waiting_room" && now - waitingSince >= deadlines.waitingRoomMs) {
        await fail("waiting_room_timeout");
        return;
      }
      await page.waitForTimeout(POLL_MS);
    }

    emit(joinedLine());
    const joinedAt = Date.now();
    await dismissOverlays(page);
    await turnOffDevices(page);
    await sink.armCaptureWatchdog(page);

    let why = "timeout";
    let polls = 0;
    while (Date.now() - joinedAt < deadlines.maxMs) {
      if (stopRequested) {
        why = "signal";
        break;
      }
      if (page.isClosed()) {
        why = "page_closed";
        break;
      }
      if (polls < 5) {
        polls += 1;
        await turnOffDevices(page);
      }
      // Конец звонка только по экрану: кнопки выхода в странице нет, а на экране
      // конец звонка, отказ или «встреча не найдена» (бота выкинули). Иначе бот
      // остаётся до сигнала или предела 4 часа, даже если все вышли.
      const url = page.url();
      const text = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
      if (callOver({ url, text, leaveButtonInPage: await leaveButtonInPage(page) })) {
        why = "ui";
        break;
      }
      await page.waitForTimeout(POLL_MS).catch(() => {});
    }
    emit(endedLine(why));
    await finishCall(0, { leave: why !== "page_closed" });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).split("\n")[0];
    if (joined) {
      // В звонке отказ не печатается: рантайм отбросил бы уже записанный звук.
      emit(endedLine("error"));
      emit(`PM_BOT_STEP:ошибка страницы: ${message}`);
      await finishCall(1);
      return;
    }
    await fail("unexpected", message);
  }
}

await main();
