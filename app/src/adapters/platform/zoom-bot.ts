/**
 * Zoom-бот: только то, что про Zoom. Разбор ссылки, подпись SDK, окружение
 * контейнера и локальный запуск через Playwright. Поиск docker, аргументы и сам
 * запуск `docker run`, разбор stdout и путь к файлу звука живут в `bot-runtime.ts`;
 * имя образа и переменная `ZOOM_BOT_IMAGE` в `bot-images.ts`.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { Meeting } from "../../shared/types.ts"
import { BOT_IMAGES, botImageName } from "./bot-images.ts"
import {
  botAppRoot,
  botDockerRunArgs,
  botRoleLabel,
  isDockerReady,
  meetingAudioFile,
  parseBotAudioLine,
  runBrowserBot,
  type BotSpawnContext,
} from "./bot-runtime.ts"
import { createMeetingSdkJwt } from "./zoom-jwt.ts"
import { parseZoomMeetingUrl } from "./zoom-url.ts"

export {
  audioFileIfPresent,
  dockerBin,
  isDockerReady,
  meetingAudioFile,
  runCommand,
  whichDocker,
} from "./bot-runtime.ts"

export type ZoomBotStatus = "joined" | "waiting_room"

export type ZoomBotResult = {
  audioPath: string | null
  status: ZoomBotStatus
  botName: string
}

export const ZOOM_BOT_IMAGE_DEFAULT = BOT_IMAGES.zoom.image
export const ZOOM_BOT_ROLE_LABEL = botRoleLabel("zoom")
const botDir = join(botAppRoot(), "bot/zoom-web")

/** Имена переменных Zoom, проброшенных в контейнер из окружения процесса. */
const ZOOM_CONTAINER_ENV_NAMES = [
  "ZOOM_MEETING_NUMBER",
  "ZOOM_MEETING_PWD",
  "ZOOM_MEETING_HOST",
  "ZOOM_SDK_JWT",
  "ZOOM_CLIENT_ID",
  "ZOOM_BOT_NAME",
]

/**
 * Всё, что Zoom добавляет к `docker run`. Одни и те же значения идут и в
 * `runBrowserBot`, и в `zoomBotDockerRunArgs`: аргументы собирает только рантайм.
 */
const ZOOM_DOCKER = {
  label: ZOOM_BOT_ROLE_LABEL,
  envNames: ZOOM_CONTAINER_ENV_NAMES,
  containerEnv: { ZOOM_BOT_HEADLESS: "1" },
  // Образ Zoom читает путь звука из ZOOM_AUDIO_PATH: собранный раньше образ работает без пересборки.
  audioPathEnv: "ZOOM_AUDIO_PATH",
}

export function zoomBotDockerRunArgs(
  image: string,
  hostAudioDir: string,
  containerAudio: string,
): string[] {
  return botDockerRunArgs({ image, hostAudioDir, containerAudio, ...ZOOM_DOCKER })
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

export function zoomBotImage(env: NodeJS.ProcessEnv = process.env): string {
  return botImageName("zoom", env) ?? ZOOM_BOT_IMAGE_DEFAULT
}

/** Старое имя разбора строки звука: контейнер Zoom печатает `ZOOM_BOT_AUDIO_SAVED:`. */
export const parseAudioSavedLine = parseBotAudioLine

function botChildEnv(meetingUrl: string): NodeJS.ProcessEnv {
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
  }
}

/** Локальный запуск без Docker: тот же join.mjs процессом Node с Playwright. */
async function spawnLocalBot(ctx: BotSpawnContext): Promise<ChildProcess> {
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
  return spawn(process.execPath, [joinJs], {
    cwd: botDir,
    env: {
      ...ctx.env,
      ZOOM_BOT_HEADLESS: process.env.ZOOM_BOT_HEADLESS ?? "0",
      ZOOM_AUDIO_PATH: ctx.audioPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
}

export type RunZoomBotDeps = {
  dockerReady?: () => Promise<boolean>
  /** Локальный запуск без Docker. Запуск в Docker не подменяется: он весь в `bot-runtime.ts`. */
  spawnLocal?: (ctx: BotSpawnContext) => Promise<ChildProcess>
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
  // Docker берётся только по явной просьбе: ZOOM_BOT_RUNTIME=docker.
  const preferDocker = (process.env.ZOOM_BOT_RUNTIME?.trim() || "auto") === "docker"
  const dockerOk = await (deps.dockerReady ?? isDockerReady)()
  const useDocker = preferDocker && dockerOk
  const result = await runBrowserBot({
    image: zoomBotImage(),
    audioPath: expectedAudio,
    env: botChildEnv(meeting.url),
    name: "Zoom-бота",
    extraAudioPaths: [meetingAudioFile(meetingId, "wav")],
    hooks: { onJoined: deps.onJoined, onWaitingRoom: deps.onWaitingRoom },
    ...ZOOM_DOCKER,
    // С Docker процесс поднимает рантайм (`docker run` по умолчанию); без него
    // локальный Playwright.
    ...(useDocker ? {} : { spawnBot: deps.spawnLocal ?? spawnLocalBot }),
  })
  return {
    audioPath: result.audioPath,
    status: result.status,
    botName: zoomBotName(),
  }
}

export async function joinZoomMeeting(
  meeting: Pick<Meeting, "url" | "id">,
  deps: RunZoomBotDeps = {},
): Promise<{ mode: "live"; audioPath: string | null }> {
  const result = await runZoomBot(meeting, deps)
  return { mode: "live", audioPath: result.audioPath }
}
