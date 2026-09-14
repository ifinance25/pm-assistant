import { existsSync, rmSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { RunBrowserBotSpec } from "./bot-runtime.ts"

/**
 * Шов теста — `runBrowserBot`: Docker в тестах не запускается никогда,
 * join проверяется через `JoinAdapter.join` (здесь напрямую `joinMeetMeeting`
 * и через `createJoinAdapter()`), а сам запуск контейнера подменяется.
 */
const runBrowserBotMock = vi.hoisted(() => vi.fn())

vi.mock("./bot-runtime.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bot-runtime.ts")>()
  return { ...actual, runBrowserBot: runBrowserBotMock }
})

const { hasMeetBotRuntime, joinMeetMeeting, meetBotImage, meetBotName, MEET_BOT_ROLE_LABEL } =
  await import("./meet-bot.ts")
const { createJoinAdapter } = await import("./join.ts")
const { meetingAudioFile } = await import("./bot-runtime.ts")

function meetMeeting(id = "m-meet-1") {
  return { id, url: "https://meet.google.com/abc-defg-hij" }
}

afterEach(() => {
  runBrowserBotMock.mockReset()
  delete process.env.MEET_BOT_NAME
  const path = meetingAudioFile(meetMeeting().id)
  if (existsSync(path)) {
    rmSync(path, { force: true })
  }
})

describe("hasMeetBotRuntime", () => {
  it("контейнер Meet (таск 02) уже в дереве исходников", () => {
    expect(hasMeetBotRuntime()).toBe(true)
  })
})

describe("meetBotName / meetBotImage", () => {
  it("имя по умолчанию «PM Assistant», образ из BOT_IMAGES", () => {
    expect(meetBotName()).toBe("PM Assistant")
    expect(meetBotImage()).toBe("pm-assistant-meet-bot")
  })

  it("MEET_BOT_NAME переопределяет имя гостя", () => {
    process.env.MEET_BOT_NAME = "Ассистент встреч"
    expect(meetBotName()).toBe("Ассистент встреч")
  })
})

describe("joinMeetMeeting", () => {
  it("сразу в звонке: onJoined один раз, waiting room не звался", async () => {
    runBrowserBotMock.mockImplementation(async (spec: RunBrowserBotSpec) => {
      await spec.hooks?.onJoined?.({ mode: "live" })
      return { audioPath: "/audio/m.webm", status: "joined" }
    })
    const onJoined = vi.fn()
    const onWaitingRoom = vi.fn()
    const result = await joinMeetMeeting(meetMeeting(), { onJoined, onWaitingRoom })
    expect(result).toEqual({ mode: "live", audioPath: "/audio/m.webm" })
    expect(onJoined).toHaveBeenCalledTimes(1)
    expect(onWaitingRoom).not.toHaveBeenCalled()
    expect(runBrowserBotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "pm-assistant-meet-bot",
        label: MEET_BOT_ROLE_LABEL,
        envNames: expect.arrayContaining(["MEET_MEETING_URL", "MEET_BOT_NAME"]),
      }),
    )
  })

  it("допуск: onWaitingRoom до onJoined", async () => {
    const calls: string[] = []
    runBrowserBotMock.mockImplementation(async (spec: RunBrowserBotSpec) => {
      await spec.hooks?.onWaitingRoom?.()
      calls.push("waiting")
      await spec.hooks?.onJoined?.({ mode: "live" })
      calls.push("joined")
      return { audioPath: "/audio/m.webm", status: "waiting_room" }
    })
    const order: string[] = []
    await joinMeetMeeting(meetMeeting(), {
      onWaitingRoom: () => {
        order.push("waiting_room")
      },
      onJoined: () => {
        order.push("joined")
      },
    })
    expect(order).toEqual(["waiting_room", "joined"])
    expect(calls).toEqual(["waiting", "joined"])
  })

  it("Meet требует вход: текст ошибки от контейнера как есть", async () => {
    runBrowserBotMock.mockRejectedValue(new Error("Google Meet требует вход в аккаунт"))
    await expect(joinMeetMeeting(meetMeeting())).rejects.toThrow(
      "Google Meet требует вход в аккаунт",
    )
  })

  it("образа нет: ошибка называет точную команду сборки", async () => {
    runBrowserBotMock.mockRejectedValue(
      new Error("образ pm-assistant-meet-bot не собран. Выполните в каталоге app: npm run bot:build:meet"),
    )
    await expect(joinMeetMeeting(meetMeeting())).rejects.toThrow(/npm run bot:build:meet/)
  })

  it("Docker вовсе не установлен: заглушка, а не ошибка", async () => {
    runBrowserBotMock.mockRejectedValue(new Error("Docker не запущен: запустите Docker и повторите"))
    const result = await joinMeetMeeting(meetMeeting())
    expect(result.mode).toBe("stub")
    expect(result.audioPath).toBeTruthy()
    expect(existsSync(result.audioPath as string)).toBe(true)
  })

  it("пустой файл (< 64 байт): audioPath null, не падение", async () => {
    runBrowserBotMock.mockResolvedValue({ audioPath: null, status: "joined" })
    const result = await joinMeetMeeting(meetMeeting())
    expect(result).toEqual({ mode: "live", audioPath: null })
  })

  it("контейнер вышел досрочно: частичная запись не теряется", async () => {
    runBrowserBotMock.mockResolvedValue({ audioPath: "/audio/partial.webm", status: "joined" })
    const result = await joinMeetMeeting(meetMeeting())
    expect(result).toEqual({ mode: "live", audioPath: "/audio/partial.webm" })
  })
})

describe("createJoinAdapter() для платформы meet", () => {
  function meetingRecord() {
    return {
      id: "m-meet-2",
      url: "https://meet.google.com/abc-defg-hij",
      platform: "meet" as const,
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

  it("вызывает joinMeetMeeting вместо броска MEET_NOT_IMPLEMENTED", async () => {
    runBrowserBotMock.mockImplementation(async (spec: RunBrowserBotSpec) => {
      await spec.hooks?.onJoined?.({ mode: "live" })
      return { audioPath: "/audio/via-adapter.webm", status: "joined" }
    })
    const onJoined = vi.fn()
    const result = await createJoinAdapter().join(meetingRecord(), { onJoined })
    expect(result).toEqual({ mode: "live", audioPath: "/audio/via-adapter.webm" })
    expect(onJoined).toHaveBeenCalledWith({ mode: "live" })
  })
})
