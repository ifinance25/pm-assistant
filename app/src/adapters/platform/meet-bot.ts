/**
 * Meet-бот: вход гостем в Google Meet поверх общего браузерного рантайма
 * (`bot-runtime.ts`). Здесь только то, что специфично для Meet: имя образа,
 * переменные окружения контейнера и мягкий откат в заглушку, если Docker
 * вовсе не установлен. Поиск docker, запуск `docker run`, разбор stdout,
 * таймауты и различие «Docker не запущен» / «образа нет» живут в
 * `bot-runtime.ts`; клики внутри страницы и разбор экрана — в `bot/meet-web/`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Meeting } from "../../shared/types.ts"
import { BOT_IMAGES, botImageName } from "./bot-images.ts"
import { botAppRoot, botRoleLabel, meetingAudioFile, runBrowserBot } from "./bot-runtime.ts"

export type MeetJoinHooks = {
  onJoined?: (info: { mode: "live" | "stub" }) => void | Promise<void>
  onWaitingRoom?: () => void | Promise<void>
}

export type MeetJoinResult = { mode: "live" | "stub"; audioPath: string | null }

export const MEET_BOT_IMAGE_DEFAULT = BOT_IMAGES.meet.image
export const MEET_BOT_ROLE_LABEL = botRoleLabel("meet")

/** Имена переменных Meet, проброшенных в контейнер из окружения процесса. */
const MEET_CONTAINER_ENV_NAMES = ["MEET_MEETING_URL", "MEET_BOT_NAME"]

/**
 * Текст рантайма, когда Docker не установлен или демон не отвечает
 * (`bot-runtime.ts`, `botImageState` → `no_docker`). Совпадает дословно:
 * по нему адаптер отличает «Docker вовсе нет» (мягкий откат в заглушку) от
 * «образ не собран» (жёсткая ошибка с точной командой).
 */
const NO_DOCKER_TEXT = "Docker не запущен: запустите Docker и повторите"

export function meetBotName(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.MEET_BOT_NAME?.trim()
  return name || "PM Assistant"
}

export function meetBotImage(env: NodeJS.ProcessEnv = process.env): string {
  return botImageName("meet", env) ?? MEET_BOT_IMAGE_DEFAULT
}

/**
 * Готов ли адаптер Meet вообще пробовать вход: контейнер Meet (таск 02)
 * должен быть в дереве исходников. Проверка дешёвая и Docker не трогает —
 * сам Docker и образ проверяет `runBrowserBot`.
 */
export function hasMeetBotRuntime(): boolean {
  return existsSync(join(botAppRoot(), BOT_IMAGES.meet.dockerfile))
}

function meetChildEnv(meeting: Pick<Meeting, "url">): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MEET_MEETING_URL: meeting.url,
    MEET_BOT_NAME: meetBotName(),
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
 * Вход в Google Meet гостем. Docker вовсе не установлен — встреча уходит в
 * заглушку (`mode: "stub"`), а не в ошибку: это личный бот для пользователя
 * без Docker, а не сбой. Docker есть, а образ не собран — ошибка с точной
 * командой сборки (`botImageMissingText` внутри `runBrowserBot`). Отказ на
 * входе (например, «Google Meet требует вход в аккаунт») приходит текстом
 * из `PM_BOT_ERROR:` как есть, разбор кодов не наш.
 */
export async function joinMeetMeeting(
  meeting: Pick<Meeting, "url" | "id">,
  hooks: MeetJoinHooks = {},
): Promise<MeetJoinResult> {
  try {
    const result = await runBrowserBot({
      image: meetBotImage(),
      audioPath: meetingAudioFile(meeting.id),
      env: meetChildEnv(meeting),
      name: "Meet-бота",
      label: MEET_BOT_ROLE_LABEL,
      envNames: MEET_CONTAINER_ENV_NAMES,
      containerEnv: { MEET_BOT_HEADLESS: "1" },
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
