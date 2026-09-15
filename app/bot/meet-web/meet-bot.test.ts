import { execFileSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BOT_JOIN_TIMEOUT_MS,
  BOT_MEETING_MAX_MS,
  BOT_WAITING_ROOM_TIMEOUT_MS,
  botDockerRunArgs,
  botRoleLabel,
  runBrowserBot,
} from "../../src/adapters/platform/bot-runtime.ts"
import {
  MEET_FAILURES,
  abandonAudio,
  callOver,
  classifyMeetPage,
  containerDeadlines,
  failScreenshotPath,
  failureLines,
  joinedLine,
  readMeetConfig,
  waitingRoomLine,
} from "./meet-state.mjs"

/**
 * Контейнер Google Meet. Docker и браузер здесь не поднимаются: проверяется, что
 * контейнер читает те переменные, которые кладёт `docker run` рантайма, и что
 * его строки stdout рантайм понимает.
 */

/** Окружение контейнера так, как его соберёт `docker run -e ...`. */
function containerEnv(args: string[]): Record<string, string> {
  const env: Record<string, string> = {}
  args.forEach((arg, i) => {
    if (args[i - 1] === "-e" && arg.includes("=")) {
      const at = arg.indexOf("=")
      env[arg.slice(0, at)] = arg.slice(at + 1)
    }
  })
  return env
}

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean }

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  return child
}

/** Строка stdout контейнера и пауза, чтобы рантайм успел её разобрать. */
async function say(child: FakeChild, line: string): Promise<void> {
  child.stdout.emit("data", Buffer.from(`${line}\n`, "utf8"))
  await new Promise((resolve) => setImmediate(resolve))
}

function hostAudio(): string {
  const path = join(mkdtempSync(join(tmpdir(), "pm-meet-bot-")), "m1.webm")
  writeFileSync(path, Buffer.alloc(200, 1))
  return path
}

function startBot(child: FakeChild, audioPath: string, events: string[] = []) {
  return runBrowserBot({
    image: "pm-assistant-meet-bot",
    env: {},
    audioPath,
    label: botRoleLabel("meet"),
    name: "Meet-бота",
    spawnBot: async () => child as never,
    hooks: {
      onWaitingRoom: () => {
        events.push("waiting_room")
      },
      onJoined: () => {
        events.push("joined")
      },
    },
  })
}

describe("контейнер Meet: строки stdout", () => {
  it("экран допуска, затем вход, затем файл звука: рантайм проходит все статусы", async () => {
    const child = fakeChild()
    const audioPath = hostAudio()
    const events: string[] = []
    const running = startBot(child, audioPath, events)
    await new Promise((resolve) => setImmediate(resolve))
    await say(child, waitingRoomLine(0))
    await say(child, waitingRoomLine(30))
    expect(events).toEqual(["waiting_room"])
    await say(child, joinedLine())
    await say(child, "PM_BOT_AUDIO_SAVED:/audio/m1.webm")
    child.emit("close", 0)
    await expect(running).resolves.toEqual({ audioPath, status: "joined" })
    expect(events).toEqual(["waiting_room", "joined"])
  })
})

describe("контейнер Meet: причины выхода", () => {
  const meetUrl = "https://meet.google.com/abc-defg-hij?hl=en"

  it("Meet потребовал вход в аккаунт: рантайм получает ровно текст для пользователя", async () => {
    const signInPages = [
      {
        url: "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij",
        text: "Sign in\nUse your Google Account",
      },
      { url: meetUrl, text: "You can't join this video call\nSign in to join this call" },
    ]
    for (const page of signInPages) {
      expect(classifyMeetPage({ ...page, inCall: false })).toBe("sign_in_required")
    }
    expect(
      classifyMeetPage({ url: meetUrl, text: "Someone in the call denied your request to join", inCall: false }),
    ).toBe("denied")

    const child = fakeChild()
    const running = startBot(child, hostAudio())
    // Ожидание отказа подписано до строки: иначе отказ рантайма всплывает необработанным.
    const refused = expect(running).rejects.toThrow(/^Google Meet требует вход в аккаунт$/)
    await new Promise((resolve) => setImmediate(resolve))
    for (const line of failureLines("sign_in_required")) {
      await say(child, line)
    }
    child.emit("close", 1)
    await refused
    expect(failureLines("sign_in_required")).toContain("PM_BOT_FAIL:sign_in_required")
  })

  it("в строке PM_BOT_ERROR только русский текст, без кода и технических подробностей", () => {
    const codes = Object.keys(MEET_FAILURES)
    expect(codes).toContain("sign_in_required")
    const texts = new Set<string>()
    for (const code of codes) {
      const errors = failureLines(code, "net::ERR_NAME_NOT_RESOLVED").filter((line: string) =>
        line.startsWith("PM_BOT_ERROR:"),
      )
      expect(errors, code).toHaveLength(1)
      const text = errors[0].slice("PM_BOT_ERROR:".length)
      // Фраза с заглавной буквы на русском; «Google Meet» в начале допустим.
      expect(text, code).toMatch(/^(?:[А-ЯЁ]|Google Meet )[а-яё]*/)
      expect(text.replace(/Google Meet/g, ""), code).not.toMatch(/[A-Za-z_:]/)
      expect(text, code).not.toContain(code)
      expect(text, code).not.toContain("ERR_NAME_NOT_RESOLVED")
      // У каждой причины свой текст: вход в аккаунт не спутать с остальными.
      expect(texts.has(text), code).toBe(false)
      texts.add(text)
    }
  })

  it("остановка до входа печатает свой русский текст, а не сырой вывод процесса", () => {
    const errors = failureLines("stopped").filter((line: string) => line.startsWith("PM_BOT_ERROR:"))
    expect(errors).toHaveLength(1)
    expect(errors[0]).not.toBe(failureLines("unexpected").find((line: string) => line.startsWith("PM_BOT_ERROR:")))
  })
})

describe("контейнер Meet: конец звонка после входа", () => {
  const meetUrl = "https://meet.google.com/abc-defg-hij?hl=en"

  it("фраза конца звонка в чате при спрятанной панели не обрывает запись", () => {
    for (const chat of ["Anna: you left the meeting?", "Boris: the call has ended for me, rejoining", "Denied your request to join"]) {
      expect(callOver({ url: meetUrl, text: `Chat\n${chat}`, leaveButtonInPage: true }), chat).toBe(false)
    }
  })

  it("выкинутого бота экраны отказа и конца завершают звонок штатно", () => {
    const screens = [
      "You've been removed from the meeting\nReturn to home screen",
      "You can't join this video call\nReturn to home screen",
      "Check your meeting code",
      "The call has ended",
    ]
    for (const text of screens) {
      expect(callOver({ url: meetUrl, text, leaveButtonInPage: false }), text).toBe(true)
    }
    expect(callOver({ url: meetUrl, text: "Anna\nBoris", leaveButtonInPage: false })).toBe(false)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("контейнер Meet: отказ до входа", () => {
  it("файла звука не остаётся, AUDIO_SAVED не печатается, снимок экрана ложится рядом со звуком", async () => {
    const commonDir = join(dirname(fileURLToPath(import.meta.url)), "../common")
    const sink = await import(new URL(`file://${join(commonDir, "audio-sink.mjs")}`).href)
    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
    const audioPath = join(mkdtempSync(join(tmpdir(), "pm-meet-bot-")), "m1.webm")
    const writer = sink.createAudioWriter(audioPath)
    // Тишина комнаты ожидания, записанная до входа.
    writer.append(Buffer.alloc(200, 1).toString("base64"))
    // Файл открывается асинхронно: без этого ожидания проверка ниже прошла бы и без уборки.
    await vi.waitFor(() => expect(existsSync(audioPath)).toBe(true))
    await abandonAudio(audioPath, writer)
    writer.append(Buffer.alloc(200, 1).toString("base64"))
    expect(existsSync(audioPath)).toBe(false)
    expect(lines.some((line) => line.includes("AUDIO_SAVED"))).toBe(false)

    expect(failScreenshotPath("/audio/m1.webm")).toBe("/audio/m1.meet-fail.png")
    expect(failScreenshotPath("")).toBeNull()
  })
})

describe("контейнер Meet: окружение", () => {
  it("сам сдаётся раньше рантайма: иначе рантайм снимет контейнер и запись 4 часов потеряется", () => {
    const deadlines = containerDeadlines(readMeetConfig({}).timeouts)
    expect(deadlines.joinMs).toBeLessThan(BOT_JOIN_TIMEOUT_MS)
    expect(deadlines.waitingRoomMs).toBeLessThan(BOT_WAITING_ROOM_TIMEOUT_MS)
    // На сохранение звука после предела нужно время: остановка записи ждёт до 15 с.
    expect(BOT_MEETING_MAX_MS - deadlines.maxMs).toBeGreaterThanOrEqual(30_000)
    expect(deadlines.joinMs).toBeGreaterThanOrEqual(140_000)
  })

  it("берёт ссылку, имя гостя по умолчанию и путь звука из аргументов docker run", () => {
    const args = botDockerRunArgs({
      image: "pm-assistant-meet-bot",
      label: botRoleLabel("meet"),
      hostAudioDir: "/tmp/data/audio",
      containerAudio: "/audio/m1.webm",
      containerEnv: { MEET_MEETING_URL: "https://meet.google.com/abc-defg-hij" },
    })
    expect(args).toContain("pm-assistant.role=meet-bot")
    const config = readMeetConfig(containerEnv(args))
    expect(config.meetingUrl).toContain("https://meet.google.com/abc-defg-hij")
    expect(config.botName).toBe("PM Assistant")
    expect(config.audioPath).toBe("/audio/m1.webm")
    expect(config.timeouts).toEqual({ joinMs: 150_000, waitingRoomMs: 600_000, maxMs: 14_400_000 })
    expect(readMeetConfig({ MEET_MEETING_URL: "https://meet.google.com/abc-defg-hij", MEET_BOT_NAME: "Протокол" }).botName).toBe(
      "Протокол",
    )
  })
})

describe("контейнер Meet: образ", () => {
  const dir = dirname(fileURLToPath(import.meta.url))

  it("скрипт входа разбирается без синтаксических ошибок", () => {
    for (const name of ["join.mjs", "meet-state.mjs"]) {
      expect(existsSync(join(dir, name)), name).toBe(true)
      expect(() =>
        execFileSync(process.execPath, ["--check", join(dir, name)], { stdio: ["ignore", "ignore", "pipe"] }),
      ).not.toThrow()
    }
  })

  it("Dockerfile кладёт общий перехват звука рядом со скриптом входа и ставит метку роли", () => {
    const dockerfile = readFileSync(join(dir, "Dockerfile"), "utf8")
    expect(dockerfile).toMatch(/^FROM mcr\.microsoft\.com\/playwright:/m)
    expect(dockerfile).toMatch(/^COPY common\/audio-sink\.mjs common\/capture-audio\.js \.\/$/m)
    expect(dockerfile).toMatch(/^LABEL pm-assistant\.role=meet-bot$/m)
  })
})
