import { EventEmitter } from "node:events"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  botDockerRunArgs,
  botOwnerLabel,
  killOrphanBots,
  killOwnBots,
  parseBotAudioLine,
  runBrowserBot,
} from "./bot-runtime.ts"

/**
 * Ветка запуска Docker по умолчанию зовёт `spawn` из node:child_process.
 * Подменяем его: вызовы записываются, настоящий docker не поднимается.
 */
const docker = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: string[]; env: unknown }>,
  respond: null as null | ((command: string, args: string[]) => unknown),
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (command: string, args: string[], opts?: { env?: unknown }) => {
      docker.calls.push({ command, args, env: opts?.env })
      if (!docker.respond) {
        throw new Error("spawn в тесте без подмены")
      }
      return docker.respond(command, args)
    },
  }
})

afterEach(() => {
  docker.calls = []
  docker.respond = null
})

/** Фальшивый `docker image inspect` / `docker info`: закрывается с кодом. */
function exitsWith(code: number): FakeChild {
  const child = fakeChild()
  setImmediate(() => child.emit("close", code))
  return child
}

/**
 * Docker в тестах не запускается никогда: проверяются собранные аргументы и
 * разбор строк stdout. Процесс бота подменяется фальшивым дочерним процессом.
 */
type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: (signal?: string) => boolean
  killed: string[]
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = []
  child.kill = (signal = "SIGTERM") => {
    child.killed.push(signal)
    return true
  }
  return child
}

function say(child: FakeChild, text: string): void {
  child.stdout.emit("data", Buffer.from(text, "utf8"))
}

/** Пропускает микрозадачи: рантайм успевает подписаться на stdout процесса. */
function attached(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe("parseBotAudioLine", () => {
  it("понимает новый префикс PM_BOT_AUDIO_SAVED", () => {
    expect(
      parseBotAudioLine("PM_BOT_JOINED\nPM_BOT_AUDIO_SAVED:/audio/m1.webm\n"),
    ).toBe("/audio/m1.webm")
  })

  it("понимает старый префикс ZOOM_BOT_AUDIO_SAVED", () => {
    expect(
      parseBotAudioLine("ZOOM_BOT_AUDIO_SAVED:/tmp/a.webm\nхвост\n"),
    ).toBe("/tmp/a.webm")
  })

  it("отдаёт null на пустом пути и на строке без метки", () => {
    expect(parseBotAudioLine("PM_BOT_AUDIO_SAVED:\n")).toBeNull()
    expect(parseBotAudioLine("ZOOM_BOT_AUDIO_SAVED:   \n")).toBeNull()
    expect(parseBotAudioLine("нет метки")).toBeNull()
  })
})

describe("killOrphanBots", () => {
  it("ищет контейнеры по метке роли и снимает найденные", async () => {
    const calls: string[][] = []
    const result = await killOrphanBots({
      dockerBin: () => "/usr/local/bin/docker",
      run: async (command, args) => {
        calls.push([command, ...args])
        return args[0] === "ps"
          ? { ok: true, stdout: "a1b2c3\nd4e5f6\n", stderr: "" }
          : { ok: true, stdout: "", stderr: "" }
      },
    })
    expect(calls[0]).toEqual([
      "/usr/local/bin/docker",
      "ps",
      "-q",
      "--filter",
      "label=pm-assistant.role",
    ])
    expect(calls[1]).toEqual(["/usr/local/bin/docker", "kill", "a1b2c3", "d4e5f6"])
    expect(result.killed).toEqual(["a1b2c3", "d4e5f6"])
  })

  it("не вызывает kill, когда брошенных контейнеров нет", async () => {
    const calls: string[][] = []
    const result = await killOrphanBots({
      dockerBin: () => "/usr/local/bin/docker",
      run: async (_command, args) => {
        calls.push(args)
        return { ok: true, stdout: "\n", stderr: "" }
      },
    })
    expect(calls).toHaveLength(1)
    expect(result.killed).toEqual([])
  })

  it("без docker молчит и ничего не запускает", async () => {
    let ran = false
    const result = await killOrphanBots({
      dockerBin: () => null,
      run: async () => {
        ran = true
        return { ok: true, stdout: "", stderr: "" }
      },
    })
    expect(ran).toBe(false)
    expect(result.killed).toEqual([])
  })
})

describe("botDockerRunArgs", () => {
  it("вешает метку роли, монтирует каталог звука и ставит образ последним", () => {
    const args = botDockerRunArgs({
      image: "pm-assistant-meet-bot",
      label: "pm-assistant.role=meet-bot",
      hostAudioDir: "/host/audio",
      containerAudio: "/audio/m1.webm",
      envNames: ["MEET_BOT_NAME"],
      containerEnv: { PM_BOT_AUDIO_PATH: "/audio/m1.webm" },
    })
    expect(args.slice(0, 6)).toEqual([
      "run",
      "--rm",
      "--label",
      "pm-assistant.role=meet-bot",
      "-v",
      "/host/audio:/audio",
    ])
    expect(args).toContain("MEET_BOT_NAME")
    expect(args).toContain("PM_BOT_AUDIO_PATH=/audio/m1.webm")
    expect(args[args.length - 1]).toBe("pm-assistant-meet-bot")
  })
})

describe("runBrowserBot", () => {
  it("отдаёт joined и путь к записанному файлу", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-bot-runtime-"))
    const audioPath = join(dir, "m1.webm")
    const child = fakeChild()
    const joined: string[] = []
    const promise = runBrowserBot({
      image: "pm-assistant-meet-bot",
      label: "pm-assistant.role=meet-bot",
      audioPath,
      env: {},
      name: "Meet-бота",
      hooks: {
        onJoined: () => {
          joined.push("joined")
        },
        onWaitingRoom: () => {
          joined.push("waiting")
        },
      },
      spawnBot: async () => child as never,
    })
    await attached()
    say(child, "PM_BOT_JOINED\n")
    writeFileSync(audioPath, "x".repeat(128))
    say(child, `PM_BOT_AUDIO_SAVED:/audio/m1.webm\n`)
    const result = await promise
    expect(result).toEqual({ audioPath, status: "joined" })
    expect(joined).toEqual(["joined"])
  })

  it("через комнату ожидания зовёт onWaitingRoom и ждёт входа", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-bot-runtime-"))
    const audioPath = join(dir, "m2.webm")
    const child = fakeChild()
    const order: string[] = []
    const promise = runBrowserBot({
      image: "pm-assistant-meet-bot",
      label: "pm-assistant.role=meet-bot",
      audioPath,
      env: {},
      hooks: {
        onJoined: () => {
          order.push("joined")
        },
        onWaitingRoom: () => {
          order.push("waiting")
          say(child, "PM_BOT_JOINED\n")
        },
      },
      spawnBot: async () => child as never,
    })
    await attached()
    say(child, "PM_BOT_WAITING_ROOM\n")
    say(child, "PM_BOT_AUDIO_SAVED:/audio/m2.webm\n")
    const result = await promise
    expect(order).toEqual(["waiting", "joined"])
    // Файла нет: путь к звуку пустой. Статус после допуска — joined.
    expect(result).toEqual({ audioPath: null, status: "joined" })
  })

  it("сообщает, чей бот отвалился, и снимает процесс", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-bot-runtime-"))
    const child = fakeChild()
    const promise = runBrowserBot({
      image: "pm-assistant-meet-bot",
      label: "pm-assistant.role=meet-bot",
      audioPath: join(dir, "m3.webm"),
      env: {},
      name: "Meet-бота",
      spawnBot: async () => child as never,
    })
    await attached()
    say(child, "PM_BOT_ERROR:Google Meet требует вход в аккаунт\n")
    await expect(promise).rejects.toThrow(/требует вход в аккаунт/)
    expect(child.killed).toEqual(["SIGTERM"])
  })
})

describe("runBrowserBot: запуск Docker по умолчанию", () => {
  it("зовёт docker run с меткой роли, меткой владельца, окружением и образом последним", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-bot-runtime-"))
    const audioPath = join(dir, "m4.webm")
    const bot = fakeChild()
    docker.respond = (_command, args) => (args[0] === "run" ? bot : exitsWith(0))
    const env = { MEET_BOT_NAME: "PM Assistant" }
    const promise = runBrowserBot({
      image: "pm-assistant-meet-bot",
      label: "pm-assistant.role=meet-bot",
      audioPath,
      env,
      envNames: ["MEET_BOT_NAME"],
      containerEnv: { PM_BOT_HEADLESS: "1" },
      dockerBinPath: () => "/usr/local/bin/docker",
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const run = docker.calls.find((call) => call.args[0] === "run")
    expect(run?.command).toBe("/usr/local/bin/docker")
    expect(run?.args).toEqual([
      "run",
      "--rm",
      "--label",
      "pm-assistant.role=meet-bot",
      "-v",
      `${dir}:/audio`,
      "--label",
      expect.stringMatching(/^pm-assistant\.owner=.+/),
      "-e",
      "MEET_BOT_NAME",
      "-e",
      "PM_BOT_HEADLESS=1",
      "-e",
      "PM_BOT_AUDIO_PATH=/audio/m4.webm",
      "pm-assistant-meet-bot",
    ])
    expect(run?.env).toBe(env)
    say(bot, "PM_BOT_JOINED\n")
    writeFileSync(audioPath, "x".repeat(128))
    say(bot, "PM_BOT_AUDIO_SAVED:/audio/m4.webm\n")
    await expect(promise).resolves.toEqual({ audioPath, status: "joined" })
  })

  it("Docker жив, образа нет: ошибка с точной командой сборки, контейнер не запускается", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-bot-runtime-"))
    docker.respond = (_command, args) => exitsWith(args[0] === "info" ? 0 : 1)
    await expect(
      runBrowserBot({
        image: "pm-assistant-zoom-bot",
        label: "pm-assistant.role=zoom-bot",
        audioPath: join(dir, "m5.webm"),
        env: {},
        dockerBinPath: () => "/usr/local/bin/docker",
      }),
    ).rejects.toThrow(/не собран.*npm run bot:build:zoom/)
    expect(docker.calls.some((call) => call.args[0] === "run")).toBe(false)
  })

  it("Docker не запущен: про образ ни слова, контейнер не запускается", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-bot-runtime-"))
    docker.respond = () => exitsWith(1)
    const failure = runBrowserBot({
      image: "pm-assistant-zoom-bot",
      label: "pm-assistant.role=zoom-bot",
      audioPath: join(dir, "m6.webm"),
      env: {},
      dockerBinPath: () => "/usr/local/bin/docker",
    })
    await expect(failure).rejects.toThrow(/Docker не запущен/)
    await expect(failure).rejects.not.toThrow(/образ/)
    expect(docker.calls.some((call) => call.args[0] === "run")).toBe(false)
  })
})

describe("killOwnBots", () => {
  it("снимает только контейнеры своего процесса, а не все по метке роли", async () => {
    const calls: string[][] = []
    const result = await killOwnBots({
      dockerBin: () => "/usr/local/bin/docker",
      run: async (command, args) => {
        calls.push([command, ...args])
        return args[0] === "ps"
          ? { ok: true, stdout: "abc123\n", stderr: "" }
          : { ok: true, stdout: "", stderr: "" }
      },
    })
    const ownLabel = botDockerRunArgs({
      image: "i",
      label: "pm-assistant.role=zoom-bot",
      hostAudioDir: "/a",
      containerAudio: "/audio/x.webm",
    }).find((arg) => arg.startsWith("pm-assistant.owner="))
    expect(ownLabel).toBeDefined()
    expect(calls[0]).toEqual([
      "/usr/local/bin/docker",
      "ps",
      "-q",
      "--filter",
      `label=${ownLabel}`,
    ])
    expect(calls[0]).not.toContain("label=pm-assistant.role")
    expect(calls[1]).toEqual(["/usr/local/bin/docker", "kill", "abc123"])
    expect(result.killed).toEqual(["abc123"])
    expect(ownLabel).toBe(botOwnerLabel())
  })
})
