/**
 * Телемост-бот: вход гостем в Яндекс.Телемост поверх общего браузерного
 * рантайма (`bot-runtime.ts`). Здесь только то, что специфично для Телемоста:
 * имя образа, переменные окружения контейнера и мягкий откат в заглушку, если
 * Docker вовсе не установлен. Поиск docker, запуск `docker run`, разбор
 * stdout, таймауты и различие «Docker не запущен» / «образа нет» живут в
 * `bot-runtime.ts`; экран «продолжить в браузере», клики и разбор экрана —
 * в `bot/telemost-web/` (чистая логика в `telemost-state.mjs`, таск 04).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Meeting } from "../../shared/types.ts"
import { BOT_IMAGES, botImageName } from "./bot-images.ts"
import { botAppRoot, botRoleLabel, meetingAudioFile, runBrowserBot } from "./bot-runtime.ts"

export type TelemostJoinHooks = {
  onJoined?: (info: { mode: "live" | "stub" }) => void | Promise<void>
  onWaitingRoom?: () => void | Promise<void>
}

export type TelemostJoinResult = { mode: "live" | "stub"; audioPath: string | null }

export const TELEMOST_BOT_IMAGE_DEFAULT = BOT_IMAGES.telemost.image
export const TELEMOST_BOT_ROLE_LABEL = botRoleLabel("telemost")

/** Имена переменных Телемоста, проброшенных в контейнер из окружения процесса. */
const TELEMOST_CONTAINER_ENV_NAMES = ["TELEMOST_MEETING_URL", "TELEMOST_BOT_NAME"]

/**
 * Текст рантайма, когда Docker не установлен или демон не отвечает
 * (`bot-runtime.ts`, `botImageState` → `no_docker`). Совпадает дословно:
 * по нему адаптер отличает «Docker вовсе нет» (мягкий откат в заглушку) от
 * «образ не собран» (жёсткая ошибка с точной командой).
 */
const NO_DOCKER_TEXT = "Docker не запущен: запустите Docker и повторите"

export function telemostBotName(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.TELEMOST_BOT_NAME?.trim()
  return name || "PM Assistant"
}

export function telemostBotImage(env: NodeJS.ProcessEnv = process.env): string {
  return botImageName("telemost", env) ?? TELEMOST_BOT_IMAGE_DEFAULT
}

/**
 * Готов ли адаптер Телемоста вообще пробовать вход: контейнер Телемоста
 * (таск 04) должен быть в дереве исходников. Проверка дешёвая и Docker не
 * трогает — сам Docker и образ проверяет `runBrowserBot`.
 */
export function hasTelemostBotRuntime(): boolean {
  return existsSync(join(botAppRoot(), BOT_IMAGES.telemost.dockerfile))
}

function telemostChildEnv(meeting: Pick<Meeting, "url">): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TELEMOST_MEETING_URL: meeting.url,
    TELEMOST_BOT_NAME: telemostBotName(),
  }
}

/**
 * Заглушка без Docker: имени бота не видно, звук не пишется, но встреча не
 * должна виснуть в `joining`. Кладём короткий немой плейсхолдер на месте
 * ожидаемого файла звука, чтобы конвейер получил путь и пошёл дальше тем же
 * путём, что и пустая запись у живого бота.
 */
function writeStubPlaceholder(audioPath: string): string {
  mkdirSync(dirname(audioPath), { recursive: true })
  if (!existsSync(audioPath)) {
    writeFileSync(audioPath, Buffer.alloc(128))
  }
  return audioPath
}

/**
 * Вход в Яндекс.Телемост гостем: контейнер проходит промежуточный экран
 * «продолжить в браузере», вводит имя гостя и подключается — установленное
 * приложение Яндекса не требуется. Docker вовсе не установлен — встреча
 * уходит в заглушку (`mode: "stub"`), а не в ошибку: это личный бот для
 * пользователя без Docker, а не сбой. Docker есть, а образ не собран —
 * ошибка с точной командой сборки (`botImageMissingText` внутри
 * `runBrowserBot`). Отказ на входе (например, «Телемост требует вход в
 * аккаунт Яндекса», когда встреча требует аккаунт) приходит текстом из
 * `PM_BOT_ERROR:` как есть, разбор кодов не наш. Логин и пароль Яндекса
 * в приложении не хранятся и не запрашиваются.
 */
export async function joinTelemostMeeting(
  meeting: Pick<Meeting, "url" | "id">,
  hooks: TelemostJoinHooks = {},
): Promise<TelemostJoinResult> {
  try {
    const result = await runBrowserBot({
      image: telemostBotImage(),
      audioPath: meetingAudioFile(meeting.id),
      env: telemostChildEnv(meeting),
      name: "Телемост-бота",
      label: TELEMOST_BOT_ROLE_LABEL,
      envNames: TELEMOST_CONTAINER_ENV_NAMES,
      containerEnv: { TELEMOST_BOT_HEADLESS: "1" },
      hooks: { onJoined: hooks.onJoined, onWaitingRoom: hooks.onWaitingRoom },
    })
    return { mode: "live", audioPath: result.audioPath }
  } catch (err) {
    if (err instanceof Error && err.message === NO_DOCKER_TEXT) {
      return { mode: "stub", audioPath: writeStubPlaceholder(meetingAudioFile(meeting.id)) }
    }
    throw err
  }
}
