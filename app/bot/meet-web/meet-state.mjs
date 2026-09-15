/**
 * Чистая часть контейнера Google Meet: окружение, строки stdout, коды выхода и
 * разбор экрана. Без Playwright, чтобы тесты читали её без браузера и Docker.
 * join.mjs отвечает только за клики.
 */
import { rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Переменные окружения контейнера. Путь звука кладёт рантайм (`PM_BOT_AUDIO_PATH`). */
export const MEET_ENV = {
  meetingUrl: "MEET_MEETING_URL",
  botName: "MEET_BOT_NAME",
  audioPath: "PM_BOT_AUDIO_PATH",
  headless: "MEET_BOT_HEADLESS",
  channel: "MEET_BOT_CHANNEL",
};

export const DEFAULT_BOT_NAME = "PM Assistant";

/** Те же числа, что у рантайма и у Zoom: вход 150 с, допуск 10 мин, звонок 4 ч. */
export const MEET_TIMEOUTS = {
  joinMs: 150_000,
  waitingRoomMs: 600_000,
  maxMs: 4 * 60 * 60 * 1000,
};

function value(env, name, fallback = "") {
  return String(env[name] ?? "").trim() || fallback;
}

/** Ссылка на встречу Meet с английским интерфейсом (`hl=en`) или null. */
export function normalizeMeetUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || url.pathname.length < 2) {
    return null;
  }
  if (!url.searchParams.has("hl")) {
    url.searchParams.set("hl", "en");
  }
  return url.toString();
}

export function readMeetConfig(env = process.env) {
  return {
    meetingUrl: normalizeMeetUrl(value(env, MEET_ENV.meetingUrl)),
    botName: value(env, MEET_ENV.botName, DEFAULT_BOT_NAME),
    audioPath: value(env, MEET_ENV.audioPath),
    headless: value(env, MEET_ENV.headless, "1") !== "0",
    channel: value(env, MEET_ENV.channel),
    timeouts: { ...MEET_TIMEOUTS },
  };
}

/** Префикс всех строк stdout: его понимают рантайм (BOT_MARKER) и bot/common. */
export const LOG_PREFIX = "PM_BOT_";

/**
 * Строка ожидания допуска. Первая переводит встречу в `waiting_room`, дальше
 * печатается раз в полминуты, пока бота не впустят.
 */
export function waitingRoomLine(waitedSec) {
  return `${LOG_PREFIX}WAITING_ROOM:ждёт допуска ${Math.max(0, Math.round(waitedSec))} с`;
}

export function joinedLine() {
  return `${LOG_PREFIX}JOINED`;
}

/** Конец звонка: `ui`, `signal`, `page_closed`, `timeout` (4 часа), `error`. */
export function endedLine(why) {
  return `${LOG_PREFIX}ENDED:${why}`;
}

/**
 * Причины отказа до входа в звонок. Рантайм показывает текст из `PM_BOT_ERROR:`
 * как есть, поэтому там только русский текст для пользователя. Код причины и
 * технические подробности идут в журнал отдельными строками `PM_BOT_FAIL:` и
 * `PM_BOT_STEP:`, на них никто не опирается.
 */
export const MEET_FAILURES = {
  unexpected: "Бот Google Meet остановился из-за непредвиденной ошибки",
  bad_config: "Боту Google Meet не передали ссылку на встречу",
  sign_in_required: "Google Meet требует вход в аккаунт",
  join_timeout: "Бот не смог войти в Google Meet за 150 секунд",
  waiting_room_timeout: "Бота не впустили в Google Meet за 10 минут",
  denied: "В Google Meet отклонили запрос бота на вход",
  meeting_not_found: "Встреча Google Meet не найдена или уже закончилась",
  browser_failed: "Не удалось запустить браузер бота Google Meet",
  stopped: "Бота Google Meet остановили до входа в звонок",
};

/** Строки отказа по порядку: код и подробности в журнал, последней текст для пользователя. */
export function failureLines(code, detail = "") {
  const known = Object.hasOwn(MEET_FAILURES, code) ? code : "unexpected";
  const lines = [`${LOG_PREFIX}FAIL:${known}`];
  const tail = String(detail || "").replace(/\s+/g, " ").trim();
  if (tail) {
    lines.push(`${LOG_PREFIX}STEP:${tail}`);
  }
  lines.push(`${LOG_PREFIX}ERROR:${MEET_FAILURES[known]}`);
  return lines;
}

// Тексты экранов Meet на английском (ссылка открывается с hl=en) и русском.
// Проверены по описаниям интерфейса, не на живом звонке: при расхождении
// поправить здесь, join.mjs их не дублирует.
const SIGN_IN =
  /sign in to join|you need to sign in|sign in with your google account|use your google account|only people signed in|войдите в аккаунт|войдите в систему|чтобы присоединиться.{0,40}войдите/i;
const CANT_JOIN = /can.t join this (?:video )?call|не удается присоединиться|невозможно присоединиться/i;
const DENIED =
  /denied your request|request to join (?:was|has been) denied|removed you from the (?:waiting|lobby)|отклонил[аи]? ваш запрос|вам отказали/i;
const NO_RESPONSE = /no one responded to your request|никто не ответил на ваш запрос/i;
const NOT_FOUND =
  /check your meeting code|invalid video call name|meeting code.{0,30}(?:doesn.t|does not) work|video call (?:doesn.t|does not) exist|проверьте код встречи|недопустимое название видеовстречи/i;
const ENDED =
  /you left the (?:meeting|call)|you.ve been removed|you have been removed|the call has ended|this (?:video )?call has ended|meeting has ended|call ended for everyone|return to home screen|вы покинули (?:встречу|видеовстречу)|вас удалили|встреча завершена|видеовстреча завершена|вернуться на главный экран/i;
const WAITING =
  /asking to be let in|you.ll join the call when someone lets you in|waiting for someone to let you in|please wait until a meeting host|wait for the host to let you in|ожидание разрешения|вы присоединитесь.{0,40}когда вас впустят|запрос на присоединение отправлен/i;

/**
 * Что сейчас на экране. `inCall` приходит из join.mjs: видна кнопка выхода из
 * звонка. Отказы проверяются раньше конца звонка: у экрана отказа тоже есть
 * «Return to home screen».
 */
export function classifyMeetPage({ url = "", text = "", inCall = false }) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (host === "accounts.google.com") {
    return "sign_in_required";
  }
  // В звонке тексты экрана (чат, подписи) на отказы не проверяются.
  if (inCall) {
    return "joined";
  }
  if (SIGN_IN.test(text) || (CANT_JOIN.test(text) && /sign in|войти в аккаунт/i.test(text))) {
    return "sign_in_required";
  }
  if (DENIED.test(text) || CANT_JOIN.test(text)) {
    return "denied";
  }
  if (NO_RESPONSE.test(text)) {
    return "no_response";
  }
  if (NOT_FOUND.test(text)) {
    return "meeting_not_found";
  }
  if (ENDED.test(text)) {
    return "ended";
  }
  if (WAITING.test(text)) {
    return "waiting_room";
  }
  return null;
}

/**
 * Пределы, по которым контейнер сдаётся сам. Рантайм считает те же 150 с, 10 мин
 * и 4 ч со своей стороны и по истечении снимает контейнер: на входе причина
 * отказа тогда теряется, а на пределе звонка теряется вся запись. Поэтому
 * контейнер укладывается раньше: на старт контейнера и на сохранение звука.
 */
export const DEADLINE_MARGIN_MS = { join: 5_000, waitingRoom: 5_000, max: 60_000 };

export function containerDeadlines(timeouts = MEET_TIMEOUTS) {
  return {
    joinMs: timeouts.joinMs - DEADLINE_MARGIN_MS.join,
    waitingRoomMs: timeouts.waitingRoomMs - DEADLINE_MARGIN_MS.waitingRoom,
    maxMs: timeouts.maxMs - DEADLINE_MARGIN_MS.max,
  };
}

/**
 * Отказ до входа: записанное (тишина экрана допуска) удаляется, `PM_BOT_AUDIO_SAVED`
 * не печатается. Писатель закрывается первым, опоздавший кусок файл не пересоздаёт.
 */
export async function abandonAudio(audioPath, writer) {
  await writer.close();
  if (audioPath) {
    rmSync(audioPath, { force: true });
  }
}

/** Снимок экрана при отказе: в смонтированный каталог звука, `<id>.meet-fail.png`. */
export function failScreenshotPath(audioPath) {
  if (!audioPath) {
    return null;
  }
  return join(dirname(audioPath), `${basename(audioPath).replace(/\.[^.]+$/, "")}.meet-fail.png`);
}

/** После входа эти экраны значат, что бота в звонке больше нет. */
const CALL_OVER_STATES = new Set(["ended", "denied", "meeting_not_found", "sign_in_required"]);

/**
 * Закончился ли звонок после `PM_BOT_JOINED`. Пока кнопка выхода есть в
 * странице (видимая или спрятанная вместе с панелью), бот в звонке, и текст
 * страницы (чат, субтитры) не проверяется. Без кнопки конец звонка, отказ и
 * «встреча не найдена» завершают запись штатно, звук сохраняется.
 */
export function callOver({ url = "", text = "", leaveButtonInPage = false }) {
  if (leaveButtonInPage) {
    return false;
  }
  return CALL_OVER_STATES.has(classifyMeetPage({ url, text, inCall: false }));
}
