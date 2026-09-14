/**
 * Чистая часть контейнера Яндекс.Телемоста: окружение, строки stdout, отказы,
 * разбор экрана и учёт пределов входа. Без Playwright: тесты читают её без
 * браузера и Docker, join.mjs отвечает только за клики.
 *
 * Протокол «контейнер → рантайм» (interfaces.md, «Общий протокол»):
 *   PM_BOT_WAITING_ROOM, PM_BOT_JOINED, PM_BOT_AUDIO_SAVED:<путь> читает рантайм;
 *   PM_BOT_ERROR:<текст> только до входа и только русский текст для пользователя;
 *   PM_BOT_STEP, PM_BOT_FAIL, PM_BOT_FAIL_STEP, PM_BOT_ENDED, PM_BOT_SCREENSHOT,
 *   PM_BOT_LOG идут только в журнал.
 */

export const LOG_PREFIX = "PM_BOT_";

export const TELEMOST_ENV = {
  meetingUrl: "TELEMOST_MEETING_URL",
  botName: "TELEMOST_BOT_NAME",
  audioPath: "PM_BOT_AUDIO_PATH",
  headless: "TELEMOST_BOT_HEADLESS",
  channel: "TELEMOST_BOT_CHANNEL",
};

export const DEFAULT_BOT_NAME = "PM Assistant";

/**
 * Часть заголовка вкладки Телемоста для флага Chromium
 * `--auto-select-tab-capture-source-by-title`, на который рассчитан
 * bot/common/capture-audio.js. На живом звонке не проверено.
 */
export const TAB_CAPTURE_TITLE = "Телемост";

/** Те же числа, что у рантайма и у Zoom: вход 150 с, допуск 10 мин, звонок 4 ч. */
export const TELEMOST_TIMEOUTS = {
  joinMs: 150_000,
  waitingRoomMs: 10 * 60 * 1000,
  maxMs: 4 * 60 * 60 * 1000,
};

/**
 * Рантайм считает те же пределы со своей стороны, начиная раньше (с запуска
 * docker), и по истечении снимает контейнер. Контейнер укладывается раньше:
 * успевает напечатать причину отказа или сохранить звук.
 */
export const DEADLINE_MARGIN_MS = { join: 10_000, waitingRoom: 10_000, max: 2 * 60 * 1000 };

/** Экран «нужен вход» должен продержаться столько, чтобы не спутать с промежуточным. */
export const AUTH_STABLE_MS = 2000;

function value(env, name, fallback = "") {
  return String(env[name] ?? "").trim() || fallback;
}

/** Ссылка http(s) или null. Что это именно Телемост, проверяет адаптер платформы. */
export function normalizeMeetingUrl(raw) {
  try {
    const url = new URL(String(raw ?? "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function readTelemostConfig(env = process.env) {
  return {
    meetingUrl: normalizeMeetingUrl(value(env, TELEMOST_ENV.meetingUrl)),
    botName: value(env, TELEMOST_ENV.botName, DEFAULT_BOT_NAME),
    audioPath: value(env, TELEMOST_ENV.audioPath),
    headless: value(env, TELEMOST_ENV.headless, "1") !== "0",
    channel: value(env, TELEMOST_ENV.channel),
  };
}

/**
 * Одна строка без переводов и без чужих меток: текст ошибки браузера не должен
 * случайно сработать как PM_BOT_JOINED или PM_BOT_ERROR в разборе рантайма.
 */
export function logSafe(text) {
  return String(text ?? "")
    .replace(/(?:PM|ZOOM)_BOT_/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** Отказы до входа. Текст уходит пользователю как есть, код выхода только для журнала. */
export const TELEMOST_FAILURES = {
  unexpected: { exitCode: 1, text: "сбой бота Телемоста до входа в звонок" },
  bad_url: {
    exitCode: 1,
    text: "в контейнер не передана ссылка на встречу Телемоста (TELEMOST_MEETING_URL)",
  },
  browser: { exitCode: 1, text: "не удалось запустить браузер бота Телемоста" },
  page: { exitCode: 1, text: "не удалось открыть страницу Телемоста" },
  stopped: { exitCode: 1, text: "бот Телемоста остановлен до входа в звонок" },
  join_timeout: {
    exitCode: 2,
    text: `не удалось войти в Телемост за ${TELEMOST_TIMEOUTS.joinMs / 1000} с`,
  },
  auth_required: { exitCode: 3, text: "Телемост требует вход в аккаунт Яндекса" },
  rejected: { exitCode: 4, text: "организатор Телемоста отклонил вход бота" },
  waiting_room_timeout: {
    exitCode: 5,
    text: `организатор не впустил бота в Телемост за ${TELEMOST_TIMEOUTS.waitingRoomMs / 60_000} минут`,
  },
  not_found: { exitCode: 6, text: "встреча Телемоста не найдена или уже завершена" },
};

/** Шаги входа словами: пользователю при таймауте нужно знать, где застрял бот. */
export const STEP_TEXT = {
  open: "открытие ссылки",
  continue_in_browser: "экран «продолжить в браузере»",
  guest_name: "ввод имени гостя",
  join: "кнопка «Подключиться»",
};

function knownFailure(code) {
  return Object.hasOwn(TELEMOST_FAILURES, code) ? code : "unexpected";
}

export function failureExitCode(code) {
  return TELEMOST_FAILURES[knownFailure(code)].exitCode;
}

/** `PM_BOT_ERROR:<русский текст>`. Шаг дописывается только к таймауту входа. */
export function failureLine(code, step = "") {
  const known = knownFailure(code);
  const stuck = known === "join_timeout" && STEP_TEXT[step] ? ` (застрял на шаге: ${STEP_TEXT[step]})` : "";
  return `${LOG_PREFIX}ERROR:${TELEMOST_FAILURES[known].text}${stuck}`;
}

export function failCodeLine(code) {
  return `${LOG_PREFIX}FAIL:${knownFailure(code)}`;
}

export function failStepLine(step) {
  return `${LOG_PREFIX}FAIL_STEP:${logSafe(step)}`;
}

export function stepLine(step) {
  return `${LOG_PREFIX}STEP:${logSafe(step)}`;
}

export function waitingRoomLine() {
  return `${LOG_PREFIX}WAITING_ROOM`;
}

export function joinedLine() {
  return `${LOG_PREFIX}JOINED`;
}

export function screenshotLine(path) {
  return `${LOG_PREFIX}SCREENSHOT:${path}`;
}

/** Строка журнала для подробностей (текст ошибки браузера и т. п.). */
export function logLine(text) {
  return `${LOG_PREFIX}LOG:${logSafe(text)}`;
}

/** Причины конца звонка: короткие коды, текст ошибки идёт отдельной строкой logLine. */
export const ENDED_REASONS = ["ui", "call_ui_gone", "signal", "page_closed", "timeout", "error"];

export function endedLine(reason) {
  return `${LOG_PREFIX}ENDED:${ENDED_REASONS.includes(reason) ? reason : "error"}`;
}

// Тексты экранов Телемоста. Подобраны по описаниям интерфейса, на живом звонке
// не проверены: при расхождении править здесь, join.mjs их не дублирует.
export const TELEMOST_RE = {
  continueInBrowser:
    /продолжить в браузере|открыть в браузере|войти через браузер|continue in (the )?browser|open in (the )?browser|join (in|from) (the )?browser/i,
  joinButton:
    /^\s*(подключиться|присоединиться|войти во встречу|войти в звонок|войти как гость|продолжить как гость|join|join now|join as guest|ask to join)\s*$/i,
  nameField: /имя|name/i,
  cameraOn: /выключить камеру|отключить камеру|turn off camera|stop video/i,
  dismiss: /^\s*(понятно|хорошо|ок|ok|got it)\s*$/i,
  leaveButton:
    /покинуть (встречу|звонок)|выйти из (встречи|звонка)|завершить (встречу|звонок)|leave (the )?(meeting|call)|end call|hang up/i,
  callControls: /^\s*(участники|чат|participants|chat)/i,
  waitingRoom:
    /организатор (скоро )?(впустит|пустит|подтвердит|добавит)|ожида(йте|ем|ние|ете)[^.\n]{0,60}(организатор|допуск|впуст|подтвержд)|зал ожидания|комнат[аеуы] ожидания|waiting for the host|host will let you in|waiting room/i,
  rejected:
    /(организатор|вам) (отклонил|отказал)|вам отказано|вас не (впустил|пустил)|не впустил|request (was )?denied|you were denied/i,
  notFound:
    /встреча не найдена|встречи не существует|такой встречи нет|ссылка (недействительна|устарела|неверна)|встреча (уже )?(завершена|закончилась)|meeting (not found|has ended)|invalid (meeting )?link/i,
  authText:
    /войдите[,\s]+чтобы|войдите в (свой )?(аккаунт|яндекс)|нужно войти|необходимо войти|требуется (вход|авторизация)|только для (авторизованных|пользователей|сотрудников)|sign in to (join|continue)/i,
  ended:
    /встреча (завершена|закончилась)|организатор завершил|вы покинули (встречу|звонок)|вас (удалили|исключили)|звонок (завершён|завершен|окончен)|оцените (качество|звонок|встречу)|meeting (has )?ended|you (have )?left the (meeting|call)|you were removed/i,
};

/** Страница входа Яндекс ID: бот туда не идёт, это отказ «нужен аккаунт». */
const AUTH_HOST = /(^|\.)(passport|id|sso)\.yandex\./i;

function hostOf(url) {
  try {
    return new URL(String(url ?? "")).hostname;
  } catch {
    return "";
  }
}

/**
 * Что на экране. join.mjs приносит адрес, текст страницы и видимость элементов:
 * `hasContinue` («продолжить в браузере»), `hasName` (поле имени), `hasJoin`
 * («Подключиться»), `hasLeave` (выход из звонка), `hasControls` («Участники», «Чат»).
 *
 * Ответ: "auth_required" | "joined" | "rejected" | "not_found" | "waiting_room"
 * | "auth_text" (похоже на «нужен вход», ждём подтверждения) | "guest_flow".
 */
export function classifyTelemostScreen(screen) {
  const s = { url: "", text: "", ...screen };
  if (AUTH_HOST.test(hostOf(s.url))) {
    return "auth_required";
  }
  const onGuestForm = Boolean(s.hasName || s.hasJoin || s.hasContinue);
  if (s.hasLeave || (s.hasControls && !onGuestForm)) {
    return "joined";
  }
  // На форме гостя тексты про вход (кнопка «Войти» в шапке) отказом не считаются.
  if (onGuestForm) {
    return "guest_flow";
  }
  if (TELEMOST_RE.rejected.test(s.text)) {
    return "rejected";
  }
  if (TELEMOST_RE.notFound.test(s.text)) {
    return "not_found";
  }
  if (TELEMOST_RE.waitingRoom.test(s.text)) {
    return "waiting_room";
  }
  if (TELEMOST_RE.authText.test(s.text)) {
    return "auth_text";
  }
  return "guest_flow";
}

/**
 * Учёт входа по снимкам экрана. `observe(screen)` отдаёт состояние экрана,
 * строки stdout для рантайма и исход: null (продолжать), "joined" или код отказа
 * из TELEMOST_FAILURES. Время входа считается с `startedAt`, ожидание допуска с
 * первого экрана ожидания; после него действует только предел ожидания.
 */
export function createEntryTracker({ startedAt, now = Date.now, timeouts = TELEMOST_TIMEOUTS }) {
  const joinDeadline = startedAt + timeouts.joinMs - DEADLINE_MARGIN_MS.join;
  let waitingDeadline = null;
  let authSince = null;
  let done = false;

  return {
    observe(screen) {
      if (done) {
        return { state: "done", lines: [], outcome: null };
      }
      const t = now();
      const state = classifyTelemostScreen(screen);
      const lines = [];
      const finish = (outcome) => {
        done = true;
        return { state, lines, outcome };
      };
      if (state === "joined") {
        lines.push(joinedLine());
        return finish("joined");
      }
      if (state === "auth_required" || state === "rejected" || state === "not_found") {
        return finish(state);
      }
      if (state === "auth_text") {
        authSince = authSince ?? t;
        if (t - authSince >= AUTH_STABLE_MS) {
          return finish("auth_required");
        }
      } else {
        authSince = null;
      }
      if (state === "waiting_room" && waitingDeadline === null) {
        waitingDeadline = t + timeouts.waitingRoomMs - DEADLINE_MARGIN_MS.waitingRoom;
        lines.push(waitingRoomLine());
      }
      if (waitingDeadline !== null && t >= waitingDeadline) {
        return finish("waiting_room_timeout");
      }
      if (waitingDeadline === null && t >= joinDeadline) {
        return finish("join_timeout");
      }
      return { state, lines, outcome: null };
    },
  };
}

/** Когда контейнер сам заканчивает звонок, чтобы звук успел сохраниться до SIGTERM рантайма. */
export function callDeadline(joinedAt, timeouts = TELEMOST_TIMEOUTS) {
  return joinedAt + timeouts.maxMs - DEADLINE_MARGIN_MS.max;
}
