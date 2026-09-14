/**
 * Бот Яндекс.Телемоста: заходит в звонок гостем по ссылке, как обычный участник,
 * и пишет звук звонка в webm/opus. Установленное приложение Яндекса не нужно:
 * бот проходит экран «продолжить в браузере». В аккаунт Яндекса бот не входит:
 * если Телемост требует вход, бот выходит с отдельной причиной.
 *
 * Здесь только клики и браузер. Окружение, строки stdout, отказы, разбор экрана
 * и пределы лежат в telemost-state.mjs (его проверяют тесты без браузера).
 * Звук пишет общий перехват из bot/common, микрофон бота подменён тишиной.
 *
 * После PM_BOT_JOINED бот PM_BOT_ERROR не печатает: рантайм счёл бы встречу
 * упавшей и выбросил записанный звук. Сбой в звонке заканчивается сохранением.
 */
import { existsSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { chromium } from "playwright";
import {
  armCaptureWatchdog,
  createAudioWriter,
  emit,
  forwardBotConsole,
  installAudioCapture,
  stopCaptureAndSave,
} from "../common/audio-sink.mjs";
import {
  TAB_CAPTURE_TITLE,
  TELEMOST_RE,
  callDeadline,
  createEntryTracker,
  endedLine,
  failCodeLine,
  failStepLine,
  failureExitCode,
  failureLine,
  logLine,
  readTelemostConfig,
  screenshotLine,
  stepLine,
} from "./telemost-state.mjs";

const POLL_MS = 500;
const END_POLL_MS = 1000;
const CLICK_COOLDOWN_MS = 2500;
/** Кнопки звонка пропали, а текста о конце нет: столько ждём, прежде чем выйти. */
const CALL_UI_GONE_MS = 30_000;

let stopRequested = false;

function errorText(err) {
  return err instanceof Error ? err.message.split("\n")[0] : String(err);
}

async function visible(locator) {
  return locator
    .first()
    .isVisible()
    .catch(() => false);
}

async function pageText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    chunks.push(
      await frame
        .locator("body")
        .innerText({ timeout: 2000 })
        .catch(() => ""),
    );
  }
  return chunks.join("\n");
}

function locators(page) {
  const re = TELEMOST_RE;
  return {
    continueInBrowser: page
      .getByRole("button", { name: re.continueInBrowser })
      .or(page.getByRole("link", { name: re.continueInBrowser })),
    nameInput: page
      .getByRole("textbox", { name: re.nameField })
      .or(page.locator('input[placeholder*="мя" i], input[placeholder*="name" i], input[name*="name" i]')),
    joinButton: page.getByRole("button", { name: re.joinButton }),
    cameraOn: page.getByRole("button", { name: re.cameraOn }),
    dismiss: page.getByRole("button", { name: re.dismiss }),
    leaveButton: page.getByRole("button", { name: re.leaveButton }),
    callControls: page.getByRole("button", { name: re.callControls }),
  };
}

/** Снимок экрана для classifyTelemostScreen. */
async function readScreen(page, loc) {
  const [text, hasContinue, hasName, hasJoin, hasLeave, hasControls] = await Promise.all([
    pageText(page),
    visible(loc.continueInBrowser),
    visible(loc.nameInput),
    visible(loc.joinButton),
    visible(loc.leaveButton),
    visible(loc.callControls),
  ]);
  return { url: page.url(), text, hasContinue, hasName, hasJoin, hasLeave, hasControls };
}

function createStepper() {
  let last = "";
  const clickedAt = new Map();
  return {
    step(name) {
      if (name !== last) {
        last = name;
        emit(stepLine(name));
      }
    },
    last: () => last,
    /** Кликает, если элемент виден и с прошлого клика по нему прошла пауза. */
    async click(key, locator) {
      const prev = clickedAt.get(key) ?? 0;
      if (Date.now() - prev < CLICK_COOLDOWN_MS || !(await visible(locator))) {
        return false;
      }
      clickedAt.set(key, Date.now());
      await locator
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
      return true;
    },
  };
}

/** Один проход по форме гостя: «продолжить в браузере», имя, камера, «Подключиться». */
async function advanceGuestFlow(loc, screen, stepper, botName) {
  if (screen.hasContinue) {
    stepper.step("continue_in_browser");
    await stepper.click("continue", loc.continueInBrowser);
    return;
  }
  await stepper.click("dismiss", loc.dismiss);
  if (screen.hasName) {
    stepper.step("guest_name");
    const input = loc.nameInput.first();
    const current = await input.inputValue({ timeout: 2000 }).catch(() => null);
    if (current !== null && current !== botName) {
      await input.fill(botName, { timeout: 3000 }).catch(() => {});
    }
  }
  await stepper.click("camera", loc.cameraOn);
  if (screen.hasJoin && (await loc.joinButton.first().isEnabled().catch(() => false))) {
    stepper.step("join");
    await stepper.click("join", loc.joinButton);
  }
}

/** Ведёт бота до звонка. Возвращает { code: "joined" } или код отказа с шагом. */
async function enterMeeting(page, botName, startedAt) {
  const loc = locators(page);
  const stepper = createStepper();
  const tracker = createEntryTracker({ startedAt });
  stepper.step("open");
  for (;;) {
    if (stopRequested) {
      return { code: "stopped", step: stepper.last() };
    }
    if (page.isClosed()) {
      return { code: "page", step: stepper.last(), detail: "страница закрылась" };
    }
    const screen = await readScreen(page, loc);
    const seen = tracker.observe(screen);
    if (seen.state === "waiting_room") {
      stepper.step("waiting_room");
    }
    for (const line of seen.lines) {
      emit(line);
    }
    if (seen.outcome) {
      return { code: seen.outcome, step: stepper.last() };
    }
    if (seen.state === "guest_flow") {
      await advanceGuestFlow(loc, screen, stepper, botName);
    }
    await page.waitForTimeout(POLL_MS).catch(() => {});
  }
}

/** Ждёт конца звонка. Возвращает короткую причину для PM_BOT_ENDED. */
async function waitUntilCallEnds(page, joinedAt) {
  const loc = locators(page);
  const deadline = callDeadline(joinedAt);
  let goneSince = null;
  for (;;) {
    if (stopRequested) {
      return "signal";
    }
    if (page.isClosed()) {
      return "page_closed";
    }
    if (Date.now() >= deadline) {
      return "timeout";
    }
    const stillInCall = (await visible(loc.leaveButton)) || (await visible(loc.callControls));
    if (stillInCall) {
      goneSince = null;
    } else {
      // Текст «встреча завершена» в чате не должен выгнать бота: смотрим текст,
      // только когда кнопок звонка на экране уже нет.
      if (TELEMOST_RE.ended.test(await pageText(page))) {
        return "ui";
      }
      goneSince = goneSince ?? Date.now();
      if (Date.now() - goneSince >= CALL_UI_GONE_MS) {
        return "call_ui_gone";
      }
    }
    await page.waitForTimeout(END_POLL_MS).catch(() => {});
  }
}

/** Снимок экрана при отказе: на хосте data/audio/<id>.telemost-fail.png. */
async function saveFailScreenshot(page, audioPath) {
  if (!page || !audioPath || page.isClosed()) {
    return;
  }
  const id = basename(audioPath).replace(/\.[^.]+$/, "");
  const path = join(dirname(audioPath), `${id}.telemost-fail.png`);
  const ok = await page
    .screenshot({ path, fullPage: true, timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (ok) {
    emit(screenshotLine(path));
  }
}

/** Отказ до входа: журнал, снимок, текст для пользователя, выход. Файла звука не остаётся. */
async function failBeforeJoin(code, { page, browser, writer, audioPath, step, detail }) {
  emit(failCodeLine(code));
  if (step) {
    emit(failStepLine(step));
  }
  if (detail) {
    emit(logLine(detail));
  }
  await saveFailScreenshot(page, audioPath);
  emit(failureLine(code, step));
  if (writer) {
    await writer.close();
  }
  if (audioPath && existsSync(audioPath)) {
    try {
      unlinkSync(audioPath);
    } catch {
      // файл перезапишется при повторе
    }
  }
  await browser?.close().catch(() => {});
  process.exit(failureExitCode(code));
}

async function leaveCall(page) {
  if (page.isClosed()) {
    return;
  }
  const leave = locators(page).leaveButton;
  if (await visible(leave)) {
    await leave
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
  }
}

function userAgentFor(browser) {
  const major = String(browser.version()).split(".")[0] || "140";
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

async function main() {
  const startedAt = Date.now();
  const onStop = () => {
    stopRequested = true;
  };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);

  const config = readTelemostConfig();
  const { audioPath, botName } = config;
  if (!config.meetingUrl) {
    await failBeforeJoin("bad_url", { audioPath });
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: config.headless,
      ...(config.channel ? { channel: config.channel } : {}),
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--mute-audio",
        "--disable-blink-features=AutomationControlled",
        "--lang=ru-RU",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--auto-select-tab-capture-source-by-title=${TAB_CAPTURE_TITLE}`,
      ],
    });
  } catch (err) {
    await failBeforeJoin("browser", { audioPath, detail: errorText(err) });
    return;
  }

  const writer = createAudioWriter(audioPath);
  let page = null;
  try {
    const context = await browser.newContext({
      locale: "ru-RU",
      permissions: ["microphone", "camera"],
      viewport: { width: 1280, height: 800 },
      userAgent: userAgentFor(browser),
    });
    await installAudioCapture(context, writer);
    page = await context.newPage();
    forwardBotConsole(page);
    try {
      await page.goto(config.meetingUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (err) {
      await failBeforeJoin("page", { page, browser, writer, audioPath, detail: errorText(err) });
      return;
    }
    const entered = await enterMeeting(page, botName, startedAt);
    if (entered.code !== "joined") {
      await failBeforeJoin(entered.code, { page, browser, writer, audioPath, ...entered });
      return;
    }
  } catch (err) {
    await failBeforeJoin("unexpected", { page, browser, writer, audioPath, detail: errorText(err) });
    return;
  }

  // PM_BOT_JOINED уже напечатан учётом входа.
  const joinedAt = Date.now();
  let code = 0;
  try {
    await armCaptureWatchdog(page);
    emit(endedLine(await waitUntilCallEnds(page, joinedAt)));
  } catch (err) {
    emit(endedLine("error"));
    emit(logLine(errorText(err)));
    code = 1;
  }
  try {
    await stopCaptureAndSave(page, audioPath, writer);
  } catch (err) {
    // Строка звука нужна рантайму в любом случае: пустой путь значит «файла нет».
    emit(logLine(`звук не сохранён: ${errorText(err)}`));
    emit("PM_BOT_AUDIO_SAVED:");
    code = 1;
  }
  await leaveCall(page);
  await browser.close().catch(() => {});
  process.exit(code);
}

main().catch((err) => {
  emit(logLine(errorText(err)));
  emit(failureLine("unexpected"));
  process.exit(failureExitCode("unexpected"));
});
