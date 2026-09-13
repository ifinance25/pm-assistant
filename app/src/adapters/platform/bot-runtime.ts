/**
 * Общий рантайм браузерных ботов: всё, что в запуске бота не про конкретную
 * платформу. Поиск docker, аргументы `docker run`, разбор stdout, путь к файлу
 * звука и уборка брошенных контейнеров живут здесь, а не в `zoom-bot.ts`.
 *
 * Платформенные модули (`zoom-bot.ts`, дальше Meet и Телемост) приносят только
 * своё: разбор ссылки, окружение контейнера и порядок кликов внутри страницы.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { botImageMissingText } from "./bot-images.ts"

export type BotStatus = "joined" | "waiting_room"

export type BotResult = {
  audioPath: string | null
  status: BotStatus
}

export type BotHooks = {
  onJoined?: (info: { mode: "live" }) => void | Promise<void>
  onWaitingRoom?: () => void | Promise<void>
}

export const BOT_JOIN_TIMEOUT_MS = 150_000
export const BOT_WAITING_ROOM_TIMEOUT_MS = 600_000
export const BOT_MEETING_MAX_MS = 4 * 60 * 60 * 1000

/** Метка, по которой уборка находит контейнеры ботов всех платформ. */
export const BOT_ROLE_LABEL_KEY = "pm-assistant.role"

export function botRoleLabel(platform: string): string {
  return `${BOT_ROLE_LABEL_KEY}=${platform}-bot`
}

/**
 * Метка владельца: какой процесс поднял контейнер. По ней `killOwnBots()`
 * снимает только свои контейнеры и не трогает бота живой встречи у воркера.
 */
export const BOT_OWNER_LABEL_KEY = "pm-assistant.owner"
const BOT_OWNER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`

export function botOwnerLabel(owner = BOT_OWNER_ID): string {
  return `${BOT_OWNER_LABEL_KEY}=${owner}`
}

/** Под этим именем контейнер получает путь файла звука, если платформа не назвала своё. */
export const BOT_AUDIO_PATH_ENV = "PM_BOT_AUDIO_PATH"

/**
 * Метки в stdout бота. Новые боты печатают `PM_BOT_*`, живой Zoom печатает
 * `ZOOM_BOT_*`; рантайм понимает оба, поэтому образ Zoom можно не пересобирать.
 */
export const BOT_MARKER = {
  joined: /(?:PM|ZOOM)_BOT_JOINED/,
  waitingRoom: /(?:PM|ZOOM)_BOT_WAITING_ROOM/,
  joinedOrWaiting: /(?:PM|ZOOM)_BOT_(?:JOINED|WAITING_ROOM)/,
  audioSaved: /(?:PM|ZOOM)_BOT_AUDIO_SAVED:/,
  error: /(?:PM|ZOOM)_BOT_ERROR:(.+)/,
} as const

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")

export function botAppRoot(): string {
  return appRoot
}

/** Путь к файлу звука встречи: `data/audio/<id>.<ext>` от корня приложения. */
export function meetingAudioFile(
  meetingId: string,
  ext = "webm",
  root = appRoot,
): string {
  return join(root, "data/audio", `${meetingId}.${ext}`)
}

/** Разбирает строку `PM_BOT_AUDIO_SAVED:<путь>` (и старую `ZOOM_BOT_...`). */
export function parseBotAudioLine(text: string): string | null {
  const match = text.match(/(?:PM|ZOOM)_BOT_AUDIO_SAVED:(.+)/)
  const saved = match?.[1]?.trim() ?? ""
  return saved.length > 0 ? saved : null
}

export function audioFileIfPresent(path: string | null): string | null {
  if (!path || !existsSync(path)) {
    return null
  }
  try {
    return statSync(path).size > 64 ? path : null
  } catch {
    return null
  }
}

export function dockerBin(): string | null {
  const candidates = [
    "docker",
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ]
  for (const bin of candidates) {
    if (bin === "docker") {
      continue
    }
    if (existsSync(bin)) {
      return bin
    }
  }
  return existsSync("/usr/local/bin/docker") ? "/usr/local/bin/docker" : "docker"
}

export function whichDocker(): string | null {
  const explicit = [
    "/usr/local/bin/docker",
    "/usr/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ]
  for (const bin of explicit) {
    if (existsSync(bin)) {
      return bin
    }
  }
  return null
}

export type RunResult = { ok: boolean; stdout: string; stderr: string }

export function runCommand(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer =
      opts.timeoutMs == null
        ? null
        : setTimeout(() => {
            child.kill("SIGKILL")
          }, opts.timeoutMs)
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", (err) => {
      if (timer) clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: `${stderr}${err.message}` })
    })
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr })
    })
  })
}

export type DockerDeps = {
  dockerBin?: () => string | null
  run?: (command: string, args: string[]) => Promise<RunResult>
}

function dockerRunner(deps: DockerDeps): DockerDeps["run"] & {} {
  return deps.run ?? ((command, args) => runCommand(command, args, { timeoutMs: 8_000 }))
}

export type BotImageState = "ready" | "no_docker" | "no_image"

/**
 * Есть ли образ. «Образа нет» говорится только тогда, когда демон Docker ответил,
 * а образ не нашёлся; иначе «Docker не запущен».
 */
export async function botImageState(
  image: string,
  deps: DockerDeps = {},
): Promise<BotImageState> {
  const bin = (deps.dockerBin ?? whichDocker)()
  if (!bin) {
    return "no_docker"
  }
  const run = dockerRunner(deps)
  const inspected = await run(bin, ["image", "inspect", "--format", "{{.Id}}", image])
  if (inspected.ok) {
    return "ready"
  }
  const info = await run(bin, ["info"])
  return info.ok ? "no_image" : "no_docker"
}

export async function isDockerReady(): Promise<boolean> {
  const bin = whichDocker()
  if (!bin) {
    return false
  }
  const result = await runCommand(bin, ["info"], { timeoutMs: 8_000 })
  return result.ok
}

export type DockerRunArgsSpec = {
  image: string
  label: string
  hostAudioDir: string
  containerAudio: string
  /** Имя переменной с путём звука в контейнере. По умолчанию `PM_BOT_AUDIO_PATH`. */
  audioPathEnv?: string
  /** Имена переменных, проброшенных из окружения процесса: `-e NAME`. */
  envNames?: string[]
  /** Переменные со значением: `-e NAME=value`. */
  containerEnv?: Record<string, string>
  /** Владелец контейнера. По умолчанию текущий процесс. */
  owner?: string
}

export function botDockerRunArgs(spec: DockerRunArgsSpec): string[] {
  const args = [
    "run",
    "--rm",
    "--label",
    spec.label,
    "-v",
    `${spec.hostAudioDir}:/audio`,
    "--label",
    botOwnerLabel(spec.owner),
  ]
  for (const name of spec.envNames ?? []) {
    args.push("-e", name)
  }
  for (const [name, value] of Object.entries(spec.containerEnv ?? {})) {
    args.push("-e", `${name}=${value}`)
  }
  args.push("-e", `${spec.audioPathEnv ?? BOT_AUDIO_PATH_ENV}=${spec.containerAudio}`)
  args.push(spec.image)
  return args
}

export function sanitizeBotLog(text: string): string {
  return text.replace(/pwd=[^&\s]+/gi, "pwd=***")
}

export type BotLog = {
  waitFor(
    pattern: RegExp,
    timeoutMs: number,
    opts?: { resolveOnClose?: boolean; killOnTimeout?: boolean },
  ): Promise<string>
  combined(): string
}

/**
 * Слушает stdout/stderr процесса бота и даёт ждать метку. `name` попадает в
 * текст ошибки: пользователь читает, чей именно бот отвалился.
 */
export function attachBotLog(child: ChildProcess, name = "бота"): BotLog {
  let combined = ""
  const chunkListeners: Array<(combined: string) => void> = []
  let fatal: Error | null = null

  const onData = (chunk: Buffer) => {
    const text = chunk.toString("utf8")
    combined += text
    process.stderr.write(sanitizeBotLog(text))
    const errMatch = text.match(BOT_MARKER.error)
    if (errMatch) {
      fatal = new Error(errMatch[1].trim())
    }
    for (const listener of [...chunkListeners]) {
      listener(combined)
    }
  }
  child.stdout?.on("data", onData)
  child.stderr?.on("data", onData)

  function waitFor(
    pattern: RegExp,
    timeoutMs: number,
    opts: { resolveOnClose?: boolean; killOnTimeout?: boolean } = {},
  ): Promise<string> {
    const killOnTimeout = opts.killOnTimeout !== false
    return new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const onChunk = (full: string) => {
        if (fatal) {
          finish(() => reject(fatal as Error))
          return
        }
        if (pattern.test(full)) {
          finish(() => resolve(full))
        }
      }
      const onClose = (code: number | null) => {
        if (pattern.test(combined) || (opts.resolveOnClose && code === 0)) {
          finish(() => resolve(combined))
          return
        }
        finish(() =>
          reject(
            new Error(
              `процесс ${name} завершился с кодом ${code}. Вывод: ${sanitizeBotLog(combined).slice(-1500)}`,
            ),
          ),
        )
      }
      const onError = (err: Error) => {
        finish(() => reject(err))
      }
      function finish(fn: () => void) {
        if (settled) {
          return
        }
        settled = true
        if (timer) {
          clearTimeout(timer)
        }
        const idx = chunkListeners.indexOf(onChunk)
        if (idx >= 0) {
          chunkListeners.splice(idx, 1)
        }
        child.off("close", onClose)
        child.off("error", onError)
        fn()
      }
      if (fatal) {
        finish(() => reject(fatal as Error))
        return
      }
      if (pattern.test(combined)) {
        finish(() => resolve(combined))
        return
      }
      timer = setTimeout(() => {
        if (killOnTimeout) {
          child.kill("SIGTERM")
        }
        finish(() =>
          reject(
            new Error(
              `таймаут ожидания ${name} (${Math.round(timeoutMs / 1000)} с). Последний вывод: ${sanitizeBotLog(combined).slice(-1500)}`,
            ),
          ),
        )
      }, timeoutMs)
      chunkListeners.push(onChunk)
      child.on("close", onClose)
      child.on("error", onError)
    })
  }

  return { waitFor, combined: () => combined }
}

/**
 * Путь звука, напечатанный контейнером, ведёт в `/audio` внутри контейнера.
 * На хосте тот же файл лежит рядом с ожидаемым путём.
 */
export function hostAudioPath(
  saved: string | null,
  expectedAudio: string,
): string | null {
  if (!saved) {
    return null
  }
  if (!saved.startsWith("/audio/")) {
    return saved
  }
  return join(dirname(expectedAudio), saved.split("/").pop() ?? "")
}

export type BotSpawnContext = {
  image: string
  label: string
  audioPath: string
  hostAudioDir: string
  containerAudio: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export type RunBrowserBotSpec = {
  /** Имя Docker-образа платформы. */
  image: string
  /** Окружение процесса бота: из него `docker run` берёт переменные `envNames`. */
  env: NodeJS.ProcessEnv
  /** Ожидаемый путь файла звука на хосте. */
  audioPath: string
  /** Метка роли: `pm-assistant.role=<платформа>-bot`. */
  label: string
  hooks?: BotHooks
  /** Переменные окружения, проброшенные в контейнер по имени. */
  envNames?: string[]
  /** Переменные контейнера со значением. */
  containerEnv?: Record<string, string>
  /** Имя переменной с путём звука в контейнере. По умолчанию `PM_BOT_AUDIO_PATH`. */
  audioPathEnv?: string
  /** Имя бота в текстах ошибок, например «Meet-бота». */
  name?: string
  timeouts?: {
    joinMs?: number
    waitingRoomMs?: number
    maxMs?: number
  }
  /** Куда ещё смотреть за файлом звука, если бот сохранил его под другим именем. */
  extraAudioPaths?: string[]
  /** Чем поднять процесс. По умолчанию `docker run`; Zoom без Docker поднимает локальный Playwright. */
  spawnBot?: (ctx: BotSpawnContext) => Promise<ChildProcess>
  /** Где искать docker. Подменяется в тестах. */
  dockerBinPath?: () => string | null
}

/**
 * Поднимает браузерного бота, ждёт вход (через комнату ожидания, если она есть),
 * дожидается сохранения звука и отдаёт путь к файлу на хосте.
 */
export async function runBrowserBot(spec: RunBrowserBotSpec): Promise<BotResult> {
  const audioPath = spec.audioPath
  const hostAudioDir = dirname(audioPath)
  mkdirSync(hostAudioDir, { recursive: true })
  const containerAudio = `/audio/${audioPath.split("/").pop() ?? "meeting.webm"}`
  const args = botDockerRunArgs({
    image: spec.image,
    label: spec.label,
    hostAudioDir,
    containerAudio,
    audioPathEnv: spec.audioPathEnv,
    envNames: spec.envNames,
    containerEnv: spec.containerEnv,
  })
  const ctx: BotSpawnContext = {
    image: spec.image,
    label: spec.label,
    audioPath,
    hostAudioDir,
    containerAudio,
    args,
    env: spec.env,
  }
  const spawnBot =
    spec.spawnBot ??
    (async (inner: BotSpawnContext) => {
      const bin = (spec.dockerBinPath ?? whichDocker)()
      if (!bin) {
        throw new Error("бинарник docker не найден")
      }
      const state = await botImageState(inner.image, { dockerBin: () => bin })
      if (state === "no_docker") {
        throw new Error("Docker не запущен: запустите Docker и повторите")
      }
      if (state === "no_image") {
        throw new Error(botImageMissingText(inner.image))
      }
      return spawn(bin, inner.args, {
        env: inner.env,
        stdio: ["ignore", "pipe", "pipe"],
      })
    })
  const child = await spawnBot(ctx)
  const log = attachBotLog(child, spec.name ?? "бота")
  try {
    const first = await log.waitFor(
      BOT_MARKER.joinedOrWaiting,
      spec.timeouts?.joinMs ?? BOT_JOIN_TIMEOUT_MS,
    )
    let status: BotStatus = BOT_MARKER.joined.test(first) ? "joined" : "waiting_room"
    if (status === "waiting_room") {
      await spec.hooks?.onWaitingRoom?.()
      await log.waitFor(
        BOT_MARKER.joined,
        spec.timeouts?.waitingRoomMs ?? BOT_WAITING_ROOM_TIMEOUT_MS,
      )
      status = "joined"
    }
    await spec.hooks?.onJoined?.({ mode: "live" })
    await log.waitFor(
      BOT_MARKER.audioSaved,
      spec.timeouts?.maxMs ?? BOT_MEETING_MAX_MS,
      { resolveOnClose: true, killOnTimeout: true },
    )
    const saved = hostAudioPath(parseBotAudioLine(log.combined()), audioPath)
    let found = audioFileIfPresent(saved) ?? audioFileIfPresent(audioPath)
    for (const extra of spec.extraAudioPaths ?? []) {
      found = found ?? audioFileIfPresent(extra)
    }
    return { audioPath: found, status }
  } catch (err) {
    child.kill("SIGTERM")
    throw err
  }
}

export type KillOrphanBotsDeps = DockerDeps

/**
 * Снимает контейнеры ботов, брошенные упавшим воркером: без этого контейнер
 * пишет звук ещё до четырёх часов после перезапуска. Снимает все контейнеры
 * с меткой роли, поэтому зовётся только при старте воркера, до первого задания.
 */
export async function killOrphanBots(
  deps: KillOrphanBotsDeps = {},
): Promise<{ killed: string[] }> {
  return killBotsByLabel(BOT_ROLE_LABEL_KEY, deps)
}

/**
 * Снимает только контейнеры, поднятые этим процессом (метка владельца).
 * Для `bot:probe`: бот живой встречи у воркера остаётся жить.
 */
export async function killOwnBots(
  deps: DockerDeps & { owner?: string } = {},
): Promise<{ killed: string[] }> {
  return killBotsByLabel(botOwnerLabel(deps.owner), deps)
}

async function killBotsByLabel(
  label: string,
  deps: DockerDeps,
): Promise<{ killed: string[] }> {
  const bin = (deps.dockerBin ?? whichDocker)()
  if (!bin) {
    return { killed: [] }
  }
  const run = dockerRunner(deps)
  const listed = await run(bin, ["ps", "-q", "--filter", `label=${label}`])
  if (!listed.ok) {
    return { killed: [] }
  }
  const ids = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (ids.length === 0) {
    return { killed: [] }
  }
  const killed = await run(bin, ["kill", ...ids])
  return { killed: killed.ok ? ids : [] }
}
