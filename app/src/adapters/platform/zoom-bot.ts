import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import type { Meeting } from "../../shared/types.ts"
import { createMeetingSdkJwt } from "./zoom-jwt.ts"
import { parseZoomMeetingUrl } from "./zoom-url.ts"

export type ZoomBotStatus = "joined" | "waiting_room"

export type ZoomBotResult = {
  audioPath: string | null
  status: ZoomBotStatus
  botName: string
}

const JOIN_TIMEOUT_MS = 150_000
const WAITING_ROOM_TIMEOUT_MS = 600_000
const MEETING_MAX_MS = 4 * 60 * 60 * 1000
export const ZOOM_BOT_IMAGE_DEFAULT = "pm-assistant-zoom-bot"
export const ZOOM_BOT_ROLE_LABEL = "pm-assistant.role=zoom-bot"
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const botDir = join(appRoot, "bot/zoom-web")

export function zoomBotDockerRunArgs(
  image: string,
  hostAudioDir: string,
  containerAudio: string,
): string[] {
  return [
    "run",
    "--rm",
    "--label",
    ZOOM_BOT_ROLE_LABEL,
    "-v",
    `${hostAudioDir}:/audio`,
    "-e",
    "ZOOM_MEETING_NUMBER",
    "-e",
    "ZOOM_MEETING_PWD",
    "-e",
    "ZOOM_MEETING_HOST",
    "-e",
    "ZOOM_SDK_JWT",
    "-e",
    "ZOOM_CLIENT_ID",
    "-e",
    "ZOOM_BOT_NAME",
    "-e",
    "ZOOM_BOT_HEADLESS=1",
    "-e",
    `ZOOM_AUDIO_PATH=${containerAudio}`,
    image,
  ]
}

export function hasZoomSdkCredentials(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.ZOOM_CLIENT_ID?.trim() && env.ZOOM_CLIENT_SECRET?.trim())
}

export function zoomBotName(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.ZOOM_BOT_NAME?.trim()
  return name || "PM Assistant"
}

export function meetingAudioFile(
  meetingId: string,
  ext = "webm",
  root = appRoot,
): string {
  return join(root, "data/audio", `${meetingId}.${ext}`)
}

export function parseAudioSavedLine(text: string): string | null {
  const match = text.match(/ZOOM_BOT_AUDIO_SAVED:(.+)/)
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

export function runCommand(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
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

export async function isDockerReady(): Promise<boolean> {
  const bin = whichDocker()
  if (!bin) {
    return false
  }
  const result = await runCommand(bin, ["info"], { timeoutMs: 8_000 })
  return result.ok
}

function botChildEnv(
  meetingUrl: string,
  extra: Record<string, string>,
): NodeJS.ProcessEnv {
  const parsed = parseZoomMeetingUrl(meetingUrl)
  const clientId = process.env.ZOOM_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.ZOOM_CLIENT_SECRET?.trim() ?? ""
  const signature = createMeetingSdkJwt({
    clientId,
    clientSecret,
    meetingNumber: parsed.meetingNumber,
  })
  return {
    ...process.env,
    ZOOM_CLIENT_ID: clientId,
    ZOOM_MEETING_NUMBER: parsed.meetingNumber,
    ZOOM_MEETING_PWD: parsed.password,
    ZOOM_MEETING_HOST: parsed.host,
    ZOOM_SDK_JWT: signature,
    ZOOM_BOT_NAME: zoomBotName(),
    ...extra,
  }
}

function sanitizeBotLog(text: string): string {
  return text.replace(/pwd=[^&\s]+/gi, "pwd=***")
}

function attachBotLog(child: ChildProcess) {
  let combined = ""
  const chunkListeners: Array<(combined: string) => void> = []
  let fatal: Error | null = null

  const onData = (chunk: Buffer) => {
    const text = chunk.toString("utf8")
    combined += text
    process.stderr.write(sanitizeBotLog(text))
    const errMatch = text.match(/ZOOM_BOT_ERROR:(.+)/)
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
              `процесс Zoom-бота завершился с кодом ${code}. Вывод: ${sanitizeBotLog(combined).slice(-1500)}`,
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
              `таймаут ожидания Zoom-бота (${Math.round(timeoutMs / 1000)} с). Последний вывод: ${sanitizeBotLog(combined).slice(-1500)}`,
            ),
          ),
        )
      }, timeoutMs)
      chunkListeners.push(onChunk)
      child.on("close", onClose)
      child.on("error", onError)
    })
  }

  return {
    waitFor,
    combined: () => combined,
  }
}

async function spawnLocalBot(
  meetingUrl: string,
  audioPath: string,
): Promise<ChildProcess> {
  const joinJs = join(botDir, "join.mjs")
  if (!existsSync(joinJs)) {
    throw new Error(`нет файла бота: ${joinJs}`)
  }
  const playwrightCli = join(botDir, "node_modules/playwright/cli.js")
  if (!existsSync(playwrightCli) && !existsSync(join(botDir, "node_modules/playwright"))) {
    throw new Error(
      "Playwright для Zoom-бота не установлен. В app/bot/zoom-web выполните npm install",
    )
  }
  mkdirSync(dirname(audioPath), { recursive: true })
  return spawn(process.execPath, [joinJs], {
    cwd: botDir,
    env: botChildEnv(meetingUrl, {
      ZOOM_BOT_HEADLESS: process.env.ZOOM_BOT_HEADLESS ?? "0",
      ZOOM_AUDIO_PATH: audioPath,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  })
}

async function spawnDockerBot(
  meetingUrl: string,
  audioPath: string,
): Promise<ChildProcess> {
  const bin = whichDocker()
  if (!bin) {
    throw new Error("бинарник docker не найден")
  }
  const image = process.env.ZOOM_BOT_IMAGE?.trim() || ZOOM_BOT_IMAGE_DEFAULT
  mkdirSync(dirname(audioPath), { recursive: true })
  const containerAudio = `/audio/${audioPath.split("/").pop() ?? "meeting.webm"}`
  return spawn(
    bin,
    zoomBotDockerRunArgs(image, dirname(audioPath), containerAudio),
    {
      env: botChildEnv(meetingUrl, {}),
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
}

export type RunZoomBotDeps = {
  dockerReady?: () => Promise<boolean>
  spawnLocal?: (meetingUrl: string, audioPath: string) => Promise<ChildProcess>
  spawnDocker?: (meetingUrl: string, audioPath: string) => Promise<ChildProcess>
  onJoined?: (info: { mode: "live" }) => void | Promise<void>
  onWaitingRoom?: () => void | Promise<void>
}

export async function runZoomBot(
  meeting: Pick<Meeting, "url" | "id">,
  deps: RunZoomBotDeps = {},
): Promise<ZoomBotResult> {
  if (!hasZoomSdkCredentials()) {
    throw new Error("нет ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET")
  }
  parseZoomMeetingUrl(meeting.url)
  const meetingId = meeting.id?.trim() || randomUUID()
  const expectedAudio = meetingAudioFile(meetingId)
  mkdirSync(dirname(expectedAudio), { recursive: true })
  const runtime = process.env.ZOOM_BOT_RUNTIME?.trim() || "auto"
  const dockerOk = await (deps.dockerReady ?? isDockerReady)()
  const preferDocker = runtime === "docker"
  const useDocker = preferDocker && dockerOk
  let child: ChildProcess
  if (useDocker) {
    try {
      child = await (deps.spawnDocker ?? spawnDockerBot)(meeting.url, expectedAudio)
    } catch (err) {
      if (preferDocker) {
        throw err
      }
      child = await (deps.spawnLocal ?? spawnLocalBot)(meeting.url, expectedAudio)
    }
  } else {
    child = await (deps.spawnLocal ?? spawnLocalBot)(meeting.url, expectedAudio)
  }
  const log = attachBotLog(child)
  try {
    const first = await log.waitFor(
      /ZOOM_BOT_JOINED|ZOOM_BOT_WAITING_ROOM/,
      JOIN_TIMEOUT_MS,
    )
    let status: ZoomBotStatus = /ZOOM_BOT_JOINED/.test(first)
      ? "joined"
      : "waiting_room"
    if (status === "waiting_room" && !/ZOOM_BOT_JOINED/.test(first)) {
      await deps.onWaitingRoom?.()
      await log.waitFor(/ZOOM_BOT_JOINED/, WAITING_ROOM_TIMEOUT_MS)
      status = "joined"
    }
    await deps.onJoined?.({ mode: "live" })
    await log.waitFor(/ZOOM_BOT_AUDIO_SAVED:/, MEETING_MAX_MS, {
      resolveOnClose: true,
      killOnTimeout: true,
    })
    const saved = parseAudioSavedLine(log.combined())
    const hostSaved =
      saved && saved.startsWith("/audio/")
        ? join(dirname(expectedAudio), saved.split("/").pop() ?? "")
        : saved
    const audioPath =
      audioFileIfPresent(hostSaved) ??
      audioFileIfPresent(expectedAudio) ??
      audioFileIfPresent(meetingAudioFile(meetingId, "wav"))
    return { audioPath, status, botName: zoomBotName() }
  } catch (err) {
    child.kill("SIGTERM")
    throw err
  }
}

export async function joinZoomMeeting(
  meeting: Pick<Meeting, "url" | "id">,
  deps: RunZoomBotDeps = {},
): Promise<{ mode: "live"; audioPath: string | null }> {
  const result = await runZoomBot(meeting, deps)
  return { mode: "live", audioPath: result.audioPath }
}
