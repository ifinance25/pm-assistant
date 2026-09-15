import { describe, expect, it } from "vitest"
import {
  DEFAULT_BOT_NAME,
  ENDED_REASONS,
  TELEMOST_FAILURES,
  TELEMOST_TIMEOUTS,
  callDeadline,
  classifyTelemostScreen,
  createEntryTracker,
  endedLine,
  failCodeLine,
  failStepLine,
  failureExitCode,
  failureLine,
  joinedLine,
  logLine,
  logSafe,
  normalizeMeetingUrl,
  readTelemostConfig,
  screenshotLine,
  stepLine,
  waitingRoomLine,
  type TelemostScreen,
} from "./telemost-state.mjs"

/**
 * Чистая логика контейнера Телемоста (bot/telemost-web/telemost-state.mjs).
 * Ни Playwright, ни Docker здесь не поднимаются: проверяется разбор экрана,
 * учёт входа и строки протокола «контейнер → рантайм» (interfaces.md).
 */

const MEETING = "https://telemost.yandex.ru/j/12345678901234"

describe("classifyTelemostScreen: экран Телемоста", () => {
  it("страница входа Яндекс ID — «нужен аккаунт», даже если на ней видны кнопки формы гостя", () => {
    expect(
      classifyTelemostScreen({
        url: "https://passport.yandex.ru/auth?retpath=...",
        hasJoin: true,
      }),
    ).toBe("auth_required")
    expect(classifyTelemostScreen({ url: "https://id.yandex.ru/login" })).toBe("auth_required")
  })

  it("кнопка «Покинуть встречу» или элементы управления без формы гостя — «вошёл»", () => {
    expect(classifyTelemostScreen({ url: MEETING, hasLeave: true })).toBe("joined")
    expect(classifyTelemostScreen({ url: MEETING, hasControls: true })).toBe("joined")
  })

  it("элементы управления видны одновременно с полем имени — это ещё форма гостя, не вход", () => {
    // Панель «Участники/Чат» иногда видна и на экране предпросмотра до входа.
    expect(classifyTelemostScreen({ url: MEETING, hasControls: true, hasName: true })).toBe("guest_flow")
  })

  it("поле имени, кнопка «Подключиться» или «продолжить в браузере» — форма гостя", () => {
    expect(classifyTelemostScreen({ url: MEETING, hasName: true })).toBe("guest_flow")
    expect(classifyTelemostScreen({ url: MEETING, hasJoin: true })).toBe("guest_flow")
    expect(classifyTelemostScreen({ url: MEETING, hasContinue: true })).toBe("guest_flow")
  })

  it("текст про отказ на форме гостя не считается отказом — это ещё форма гостя", () => {
    expect(
      classifyTelemostScreen({
        url: MEETING,
        hasName: true,
        text: "Вам отказано во входе",
      }),
    ).toBe("guest_flow")
  })

  it("текст про отказ организатора вне формы гостя — «rejected»", () => {
    expect(classifyTelemostScreen({ url: MEETING, text: "Организатор отклонил вашу заявку" })).toBe("rejected")
    expect(classifyTelemostScreen({ url: MEETING, text: "Request was denied" })).toBe("rejected")
  })

  it("текст про несуществующую или завершённую встречу — «not_found»", () => {
    expect(classifyTelemostScreen({ url: MEETING, text: "Такой встречи нет" })).toBe("not_found")
    expect(classifyTelemostScreen({ url: MEETING, text: "Встреча уже завершена" })).toBe("not_found")
  })

  it("текст про ожидание допуска — «waiting_room»", () => {
    expect(classifyTelemostScreen({ url: MEETING, text: "Ожидайте, организатор скоро впустит вас" })).toBe(
      "waiting_room",
    )
    expect(classifyTelemostScreen({ url: MEETING, text: "Зал ожидания" })).toBe("waiting_room")
  })

  it("текст «нужен вход» вне формы гостя — «auth_text»", () => {
    expect(
      classifyTelemostScreen({ url: MEETING, text: "Войдите в свой аккаунт, чтобы присоединиться" }),
    ).toBe("auth_text")
  })

  it("пустой или незнакомый экран — по умолчанию форма гостя, не отказ", () => {
    expect(classifyTelemostScreen({ url: MEETING, text: "" })).toBe("guest_flow")
    expect(classifyTelemostScreen({})).toBe("guest_flow")
  })
})

describe("createEntryTracker: учёт входа", () => {
  it("допуск, затем вход: ровно две строки протокола, в этом порядке", () => {
    let t = 0
    const tracker = createEntryTracker({ startedAt: 0, now: () => t })
    const waiting: TelemostScreen = { url: MEETING, text: "Ожидайте, организатор скоро впустит вас" }
    const joined: TelemostScreen = { url: MEETING, hasLeave: true }

    t = 3_000
    const first = tracker.observe(waiting)
    expect(first).toEqual({ state: "waiting_room", lines: [waitingRoomLine()], outcome: null })

    t = 60_000
    const second = tracker.observe(waiting)
    expect(second.lines).toEqual([]) // повтор экрана ожидания не печатает строку снова
    expect(second.outcome).toBeNull()

    t = 200_000
    const third = tracker.observe(joined)
    expect(third).toEqual({ state: "joined", lines: [joinedLine()], outcome: "joined" })
  })

  it("после исхода трекер завершён: дальнейшие снимки экрана ничего не дают", () => {
    let t = 0
    const tracker = createEntryTracker({ startedAt: 0, now: () => t })
    tracker.observe({ url: MEETING, hasLeave: true })
    const after = tracker.observe({ url: MEETING, text: "Организатор отклонил вашу заявку" })
    expect(after).toEqual({ state: "done", lines: [], outcome: null })
  })

  it("отказ организатора и «не найдено» завершают вход сразу, без строк в stdout", () => {
    let t = 0
    const rejectedTracker = createEntryTracker({ startedAt: 0, now: () => t })
    const rejected = rejectedTracker.observe({ url: MEETING, text: "Организатор отклонил вашу заявку" })
    expect(rejected).toEqual({ state: "rejected", lines: [], outcome: "rejected" })

    const notFoundTracker = createEntryTracker({ startedAt: 0, now: () => t })
    const notFound = notFoundTracker.observe({ url: MEETING, text: "Такой встречи нет" })
    expect(notFound).toEqual({ state: "not_found", lines: [], outcome: "not_found" })
  })

  it("экран «нужен вход» короче двух секунд не считается отказом: гость мог кликнуть мимо", () => {
    let t = 0
    const tracker = createEntryTracker({ startedAt: 0, now: () => t })
    const authScreen: TelemostScreen = { url: MEETING, text: "Войдите в свой аккаунт, чтобы присоединиться" }

    t = 500
    expect(tracker.observe(authScreen).outcome).toBeNull()
    // Экран пропал раньше 2 с — счётчик сбрасывается, а не копится.
    t = 700
    expect(tracker.observe({ url: MEETING, hasName: true }).outcome).toBeNull()
    t = 1_500
    expect(tracker.observe(authScreen).outcome).toBeNull() // прошло только 800 мс с этого возврата
  })

  it("экран «нужен вход» держится дольше двух секунд подряд — «auth_required»", () => {
    let t = 0
    const tracker = createEntryTracker({ startedAt: 0, now: () => t })
    const authScreen: TelemostScreen = { url: MEETING, text: "Войдите в свой аккаунт, чтобы присоединиться" }

    t = 100
    expect(tracker.observe(authScreen).outcome).toBeNull()
    t = 2_200
    expect(tracker.observe(authScreen).outcome).toBe("auth_required")
  })

  it("вход не произошёл за предел времени — «join_timeout»", () => {
    let t = 0
    const tracker = createEntryTracker({ startedAt: 0, now: () => t })
    const guestForm: TelemostScreen = { url: MEETING, hasName: true }

    t = TELEMOST_TIMEOUTS.joinMs - 20_000
    expect(tracker.observe(guestForm).outcome).toBeNull()
    // Предел входа меньше TELEMOST_TIMEOUTS.joinMs на запас DEADLINE_MARGIN_MS.join (10с).
    t = TELEMOST_TIMEOUTS.joinMs - 5_000
    expect(tracker.observe(guestForm).outcome).toBe("join_timeout")
  })

  it("допуск получен, но организатор не впускает — «waiting_room_timeout» считается от входа в комнату ожидания", () => {
    let t = 0
    const tracker = createEntryTracker({ startedAt: 0, now: () => t })
    const waiting: TelemostScreen = { url: MEETING, text: "Ожидайте, организатор скоро впустит вас" }

    // Комната ожидания началась намного позже предела входа: предел входа больше не действует.
    t = TELEMOST_TIMEOUTS.joinMs + 60_000
    expect(tracker.observe(waiting).outcome).toBeNull()
    t = TELEMOST_TIMEOUTS.joinMs + 60_000 + TELEMOST_TIMEOUTS.waitingRoomMs - 5_000
    expect(tracker.observe(waiting).outcome).toBe("waiting_room_timeout")
  })
})

describe("failureLine / failureExitCode: строки для рантайма", () => {
  it("код отказа даёт ровно русский текст из TELEMOST_FAILURES", () => {
    expect(failureLine("auth_required")).toBe("PM_BOT_ERROR:Телемост требует вход в аккаунт Яндекса")
    expect(failureLine("rejected")).toBe("PM_BOT_ERROR:организатор Телемоста отклонил вход бота")
    expect(failureLine("not_found")).toBe("PM_BOT_ERROR:встреча Телемоста не найдена или уже завершена")
  })

  it("незнакомый код отказа не роняет контейнер — уходит как unexpected", () => {
    expect(failureLine("something_new")).toBe(failureLine("unexpected"))
    expect(failureExitCode("something_new")).toBe(failureExitCode("unexpected"))
  })

  it("таймаут входа дописывает шаг, на котором застрял бот; остальные коды — нет", () => {
    // 150 с — предел входа из брифа задачи («Вход не удался за 150 с»), не из кода под тестом.
    expect(failureLine("join_timeout", "guest_name")).toBe(
      "PM_BOT_ERROR:не удалось войти в Телемост за 150 с (застрял на шаге: ввод имени гостя)",
    )
    expect(failureLine("join_timeout")).toBe("PM_BOT_ERROR:не удалось войти в Телемост за 150 с")
    // Шаг без текста в STEP_TEXT не добавляется.
    expect(failureLine("join_timeout", "неизвестный_шаг")).toBe("PM_BOT_ERROR:не удалось войти в Телемост за 150 с")
    expect(failureLine("rejected", "guest_name")).toBe("PM_BOT_ERROR:организатор Телемоста отклонил вход бота")
  })

  it("код выхода различает причины: 0 для рантайма не используется, у каждого отказа свой номер", () => {
    expect(failureExitCode("unexpected")).toBe(1)
    expect(failureExitCode("bad_url")).toBe(1)
    expect(failureExitCode("join_timeout")).toBe(2)
    expect(failureExitCode("auth_required")).toBe(3)
    expect(failureExitCode("rejected")).toBe(4)
    expect(failureExitCode("waiting_room_timeout")).toBe(5)
    expect(failureExitCode("not_found")).toBe(6)
  })

  it("у каждого кода отказа свой текст: вход в аккаунт не спутать с остальными", () => {
    const texts = new Set<string>()
    for (const code of Object.keys(TELEMOST_FAILURES)) {
      const text = TELEMOST_FAILURES[code as keyof typeof TELEMOST_FAILURES].text
      expect(texts.has(text), code).toBe(false)
      texts.add(text)
    }
  })
})

describe("строки протокола «контейнер → рантайм»", () => {
  it("WAITING_ROOM, JOINED, SCREENSHOT, STEP, FAIL, FAIL_STEP — без служебных меток PM_BOT_ внутри текста", () => {
    expect(waitingRoomLine()).toBe("PM_BOT_WAITING_ROOM")
    expect(joinedLine()).toBe("PM_BOT_JOINED")
    expect(screenshotLine("/audio/m1.telemost-fail.png")).toBe("PM_BOT_SCREENSHOT:/audio/m1.telemost-fail.png")
    expect(stepLine("join")).toBe("PM_BOT_STEP:join")
    expect(failCodeLine("auth_required")).toBe("PM_BOT_FAIL:auth_required")
    expect(failStepLine("guest_name")).toBe("PM_BOT_FAIL_STEP:guest_name")
  })

  it("ENDED печатает только известные причины, иначе — error", () => {
    for (const reason of ENDED_REASONS) {
      expect(endedLine(reason)).toBe(`PM_BOT_ENDED:${reason}`)
    }
    expect(endedLine("что-то незнакомое")).toBe("PM_BOT_ENDED:error")
  })

  it("logLine и logSafe вырезают чужие метки PM_BOT_/ZOOM_BOT_, чтобы текст ошибки браузера не сработал как строка протокола", () => {
    expect(logSafe("PM_BOT_JOINED пришло случайно в тексте ошибки")).toBe("JOINED пришло случайно в тексте ошибки")
    expect(logSafe("ZOOM_BOT_AUDIO_SAVED:/x")).toBe("AUDIO_SAVED:/x")
    // Переводы строк и лишние пробелы схлопываются в один пробел.
    expect(logSafe("строка 1\n\n  строка 2\tс табом")).toBe("строка 1 строка 2 с табом")
    expect(logSafe("x".repeat(600)).length).toBe(500)
    expect(logLine("PM_BOT_ERROR:чужая метка")).toBe("PM_BOT_LOG:ERROR:чужая метка")
  })
})

describe("readTelemostConfig и normalizeMeetingUrl: окружение контейнера", () => {
  it("ссылка обязана быть http(s), иначе meetingUrl — null", () => {
    expect(normalizeMeetingUrl(MEETING)).toBe(MEETING)
    expect(normalizeMeetingUrl("не ссылка")).toBeNull()
    expect(normalizeMeetingUrl("ftp://telemost.yandex.ru/j/1")).toBeNull()
    expect(normalizeMeetingUrl("")).toBeNull()
    expect(normalizeMeetingUrl(undefined)).toBeNull()
  })

  it("имя гостя по умолчанию и headless по умолчанию включён", () => {
    const config = readTelemostConfig({ TELEMOST_MEETING_URL: MEETING })
    expect(config.meetingUrl).toBe(MEETING)
    expect(config.botName).toBe(DEFAULT_BOT_NAME)
    expect(config.headless).toBe(true)
  })

  it("TELEMOST_BOT_HEADLESS=0 выключает headless, остальные значения не выключают", () => {
    expect(readTelemostConfig({ TELEMOST_BOT_HEADLESS: "0" }).headless).toBe(false)
    expect(readTelemostConfig({ TELEMOST_BOT_HEADLESS: "1" }).headless).toBe(true)
    expect(readTelemostConfig({}).headless).toBe(true)
  })

  it("имя гостя, канал браузера и путь звука читаются из окружения дословно", () => {
    const config = readTelemostConfig({
      TELEMOST_MEETING_URL: MEETING,
      TELEMOST_BOT_NAME: "Протокол",
      TELEMOST_BOT_CHANNEL: "chrome",
      PM_BOT_AUDIO_PATH: "/audio/m1.webm",
    })
    expect(config.botName).toBe("Протокол")
    expect(config.channel).toBe("chrome")
    expect(config.audioPath).toBe("/audio/m1.webm")
  })
})

describe("callDeadline: контейнер сдаётся раньше предела рантайма", () => {
  it("предел звонка контейнера меньше BOT_MEETING_MAX_MS минимум на 30 с, чтобы звук успел сохраниться", () => {
    const joinedAt = 1_000_000
    const deadline = callDeadline(joinedAt)
    const rawDeadline = joinedAt + TELEMOST_TIMEOUTS.maxMs
    expect(rawDeadline - deadline).toBeGreaterThanOrEqual(30_000)
    expect(deadline).toBeLessThan(rawDeadline)
  })
})
