import { existsSync, rmSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { RunBrowserBotSpec } from "./bot-runtime.ts"

/**
 * Шов теста — `runBrowserBot`: Docker в тестах не запускается никогда,
 * join проверяется через `JoinAdapter.join` (здесь напрямую `joinTelemostMeeting`
 * и через `createJoinAdapter()`), а сам запуск контейнера подменяется.
 */
const runBrowserBotMock = vi.hoisted(() => vi.fn())

vi.mock("./bot-runtime.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bot-runtime.ts")>()
  return { ...actual, runBrowserBot: runBrowserBotMock }
})

const {
  hasTelemostBotRuntime,
  joinTelemostMeeting,
  telemostBotImage,
  telemostBotName,
  TELEMOST_BOT_ROLE_LABEL,
} = await import("./telemost-bot.ts")
const { createJoinAdapter } = await import("./join.ts")
const { meetingAudioFile, parseBotAudioLine, BOT_MARKER } = await import("./bot-runtime.ts")
const {
  classifyTelemostScreen,
  createEntryTracker,
  failureLine,
  joinedLine,
  waitingRoomLine,
} = await import("../../../bot/telemost-web/telemost-state.mjs")

function telemostMeeting(id = "m-telemost-1") {
  return { id, url: "https://telemost.yandex.ru/j/12345678901234" }
}

afterEach(() => {
  runBrowserBotMock.mockReset()
  delete process.env.TELEMOST_BOT_NAME
  const path = meetingAudioFile(telemostMeeting().id)
  if (existsSync(path)) {
    rmSync(path, { force: true })
  }
})

describe("hasTelemostBotRuntime", () => {
  it("контейнер Телемоста (таск 04) уже в дереве исходников", () => {
    expect(hasTelemostBotRuntime()).toBe(true)
  })
})

describe("telemostBotName / telemostBotImage", () => {
  it("имя по умолчанию «PM Assistant», образ из BOT_IMAGES", () => {
    expect(telemostBotName()).toBe("PM Assistant")
    expect(telemostBotImage()).toBe("pm-assistant-telemost-bot")
  })

  it("TELEMOST_BOT_NAME переопределяет имя гостя", () => {
    process.env.TELEMOST_BOT_NAME = "Ассистент встреч"
    expect(telemostBotName()).toBe("Ассистент встреч")
  })
})

describe("joinTelemostMeeting", () => {
  it("сразу в звонке: onJoined один раз, waiting room не звался", async () => {
    runBrowserBotMock.mockImplementation(async (spec: RunBrowserBotSpec) => {
      await spec.hooks?.onJoined?.({ mode: "live" })
      return { audioPath: "/audio/m.webm", status: "joined" }
    })
    const onJoined = vi.fn()
    const onWaitingRoom = vi.fn()
    const result = await joinTelemostMeeting(telemostMeeting(), { onJoined, onWaitingRoom })
    expect(result).toEqual({ mode: "live", audioPath: "/audio/m.webm" })
    expect(onJoined).toHaveBeenCalledTimes(1)
    expect(onWaitingRoom).not.toHaveBeenCalled()
    expect(runBrowserBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "pm-assistant-telemost-bot",
        label: TELEMOST_BOT_ROLE_LABEL,
        envNames: expect.arrayContaining(["TELEMOST_MEETING_URL", "TELEMOST_BOT_NAME"]),
      }),
    )
  })

  it("допуск: onWaitingRoom до onJoined", async () => {
    runBrowserBotMock.mockImplementation(async (spec: RunBrowserBotSpec) => {
      await spec.hooks?.onWaitingRoom?.()
      await spec.hooks?.onJoined?.({ mode: "live" })
      return { audioPath: "/audio/m.webm", status: "waiting_room" }
    })
    const order: string[] = []
    await joinTelemostMeeting(telemostMeeting(), {
      onWaitingRoom: () => {
        order.push("waiting_room")
      },
      onJoined: () => {
        order.push("joined")
      },
    })
    expect(order).toEqual(["waiting_room", "joined"])
  })

  it("Телемост требует аккаунт Яндекса: текст ошибки от контейнера как есть", async () => {
    runBrowserBotMock.mockRejectedValue(
      new Error("Телемост требует вход в аккаунт Яндекса"),
    )
    await expect(joinTelemostMeeting(telemostMeeting())).rejects.toThrow(
      "Телемост требует вход в аккаунт Яндекса",
    )
  })

  it("образа нет: ошибка называет точную команду сборки", async () => {
    runBrowserBotMock.mockRejectedValue(
      new Error(
        "образ pm-assistant-telemost-bot не собран. Выполните в каталоге app: npm run bot:build:telemost",
      ),
    )
    await expect(joinTelemostMeeting(telemostMeeting())).rejects.toThrow(
      /npm run bot:build:telemost/,
    )
  })

  it("Docker вовсе не установлен: заглушка, а не ошибка", async () => {
    runBrowserBotMock.mockRejectedValue(new Error("Docker не запущен: запустите Docker и повторите"))
    const result = await joinTelemostMeeting(telemostMeeting())
    expect(result.mode).toBe("stub")
    expect(result.audioPath).toBeTruthy()
    expect(existsSync(result.audioPath as string)).toBe(true)
  })

  it("пустой файл (< 64 байт): audioPath null, не падение", async () => {
    runBrowserBotMock.mockResolvedValue({ audioPath: null, status: "joined" })
    const result = await joinTelemostMeeting(telemostMeeting())
    expect(result).toEqual({ mode: "live", audioPath: null })
  })

  it("контейнер вышел досрочно: частичная запись не теряется", async () => {
    runBrowserBotMock.mockResolvedValue({ audioPath: "/audio/partial.webm", status: "joined" })
    const result = await joinTelemostMeeting(telemostMeeting())
    expect(result).toEqual({ mode: "live", audioPath: "/audio/partial.webm" })
  })

  it("предел встречи 4 часа: таймаут после входа приходит как обычный отказ раннера", async () => {
    runBrowserBotMock.mockImplementation(async (spec: RunBrowserBotSpec) => {
      await spec.hooks?.onJoined?.({ mode: "live" })
      throw new Error("таймаут ожидания Телемост-бота (14400 с). Последний вывод: PM_BOT_JOINED")
    })
    await expect(joinTelemostMeeting(telemostMeeting())).rejects.toThrow(/таймаут/)
  })

  it("повторная ссылка на ту же встречу: не наш шов, но join не глотает отказ раннера", async () => {
    runBrowserBotMock.mockRejectedValue(new Error("alreadyRunning"))
    await expect(joinTelemostMeeting(telemostMeeting())).rejects.toThrow("alreadyRunning")
  })
})

describe("createJoinAdapter() для платформы telemost", () => {
  function telemostMeetingRecord() {
    return {
      id: "m-telemost-2",
      url: "https://telemost.yandex.ru/j/12345678901234",
      platform: "telemost" as const,
      title: null,
      status: "queued" as const,
      recordingMode: "text" as const,
      startedAt: null,
      endedAt: null,
      error: null,
      announcementStatus: null,
      source: "stub" as const,
      audioPath: null,
      projectId: null,
    }
  }

  it("вызывает joinTelemostMeeting вместо броска TELEMOST_NOT_IMPLEMENTED", async () => {
    runBrowserBotMock.mockImplementation(async (spec: RunBrowserBotSpec) => {
      await spec.hooks?.onJoined?.({ mode: "live" })
      return { audioPath: "/audio/via-adapter.webm", status: "joined" }
    })
    const onJoined = vi.fn()
    const result = await createJoinAdapter().join(telemostMeetingRecord(), { onJoined })
    expect(result).toEqual({ mode: "live", audioPath: "/audio/via-adapter.webm" })
    expect(onJoined).toHaveBeenCalledWith({ mode: "live" })
  })
})

describe("сквозной прогон контейнер→рантайм: снимки экрана → строки stdout → исход", () => {
  /**
   * Перенесено из таска 04 (черновик telemost-container.test.ts, вне зоны
   * таска 04, блокировка 2026-09-14). Гоняет реальные снимки экрана через
   * настоящую чистую логику контейнера (`telemost-state.mjs`), берёт
   * получившиеся строки stdout и проверяет, что рантайм (`BOT_MARKER`,
   * `parseBotAudioLine`) разбирает их так, как ожидает `runBrowserBot`.
   * Docker и join.mjs здесь не участвуют.
   */
  it("экран сразу в звонке -> PM_BOT_JOINED -> рантайм видит вход, не допуск", () => {
    const tracker = createEntryTracker({ startedAt: Date.now() })
    const state = classifyTelemostScreen({ hasLeave: true, hasControls: true })
    expect(state).toBe("joined")
    const seen = tracker.observe({ hasLeave: true, hasControls: true })
    expect(seen.outcome).toBe("joined")
    const line = seen.lines[0]
    expect(line).toBe(joinedLine())
    expect(BOT_MARKER.joined.test(line)).toBe(true)
    expect(BOT_MARKER.waitingRoom.test(line)).toBe(false)
  })

  it("экран ожидания допуска -> PM_BOT_WAITING_ROOM -> рантайм видит допуск, не вход", () => {
    const tracker = createEntryTracker({ startedAt: Date.now() })
    const screen = { text: "Организатор скоро впустит вас" }
    const state = classifyTelemostScreen(screen)
    expect(state).toBe("waiting_room")
    const seen = tracker.observe(screen)
    expect(seen.outcome).toBeNull()
    const line = seen.lines[0]
    expect(line).toBe(waitingRoomLine())
    expect(BOT_MARKER.waitingRoom.test(line)).toBe(true)
    expect(BOT_MARKER.joined.test(line)).toBe(false)
  })

  it("экран требует аккаунт Яндекса -> PM_BOT_ERROR с русским текстом -> рантайм отдаёт его в join()", async () => {
    const tracker = createEntryTracker({ startedAt: Date.now() })
    const screen = { url: "https://passport.yandex.ru/auth" }
    const state = classifyTelemostScreen(screen)
    expect(state).toBe("auth_required")
    const seen = tracker.observe(screen)
    expect(seen.outcome).toBe("auth_required")
    const line = failureLine(seen.outcome as string)
    expect(line).toBe("PM_BOT_ERROR:Телемост требует вход в аккаунт Яндекса")
    const match = line.match(BOT_MARKER.error)
    expect(match?.[1].trim()).toBe("Телемост требует вход в аккаунт Яндекса")

    // Тот же текст доходит до join() адаптера как есть.
    runBrowserBotMock.mockRejectedValue(new Error(match?.[1].trim()))
    await expect(joinTelemostMeeting(telemostMeeting())).rejects.toThrow(
      "Телемост требует вход в аккаунт Яндекса",
    )
  })

  it("строка PM_BOT_AUDIO_SAVED: рантайм разбирает путь звука так же, как у Zoom и Meet", () => {
    const line = "PM_BOT_AUDIO_SAVED:/audio/m-telemost-1.webm"
    expect(BOT_MARKER.audioSaved.test(line)).toBe(true)
    expect(parseBotAudioLine(line)).toBe("/audio/m-telemost-1.webm")
  })
})
