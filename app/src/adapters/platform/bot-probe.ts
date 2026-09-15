/**
 * Проверка входа бота по ссылке без настоящей встречи: `npm run bot:probe -- <ссылка>`.
 * Отвечает по хукам входа: «вошёл» по `onJoined`, «ждёт допуска» по `onWaitingRoom`,
 * не дожидаясь конца `join` (живой join заканчивается только с концом встречи).
 */
import { randomUUID } from "node:crypto"
import type { Meeting } from "../../shared/types.ts"
import { botBuildCommand, botImageMissingText, botImageName } from "./bot-images.ts"
import { botImageState, isDockerReady } from "./bot-runtime.ts"
import { detectPlatform } from "./detect.ts"
import { createJoinAdapter, type JoinHooks, type JoinResult } from "./join.ts"

export type ProbeOutcome =
  | { kind: "joined" }
  | { kind: "waiting_room" }
  | { kind: "refused"; reason: string }

export type ProbeDeps = {
  dockerReady?: () => Promise<boolean>
  /** Есть ли образ. Зовётся только при живом Docker. */
  imageExists?: (image: string) => Promise<boolean>
  join?: (meeting: Meeting, hooks?: JoinHooks) => Promise<JoinResult>
}

export function probeText(outcome: ProbeOutcome): string {
  if (outcome.kind === "joined") {
    return "вошёл"
  }
  if (outcome.kind === "waiting_room") {
    return "ждёт допуска"
  }
  return `отказ: ${outcome.reason}`
}

function probeMeeting(url: string, platform: Meeting["platform"]): Meeting {
  return {
    id: randomUUID(),
    url,
    platform,
    title: "проверка входа бота",
    status: "queued",
    recordingMode: "text",
    startedAt: null,
    endedAt: null,
    error: null,
    announcementStatus: null,
    source: "live",
    audioPath: null,
    projectId: null,
  }
}

function stubReason(platform: string): string {
  return `бот платформы ${platform} работает заглушкой, вход не проверен`
}

export async function probe(
  url: string,
  deps: ProbeDeps = {},
): Promise<ProbeOutcome> {
  const platform = detectPlatform(url)
  if (!platform || platform === "unknown") {
    return { kind: "refused", reason: `ссылка не распознана: ${url}` }
  }
  // Платформе без образа (бот ещё не в Docker) проверять Docker незачем.
  const image = botImageName(platform)
  if (image) {
    const dockerOk = await (deps.dockerReady ?? isDockerReady)()
    if (!dockerOk) {
      return {
        kind: "refused",
        reason: `Docker не запущен: запустите Docker. Образ ${image} собирается командой ${botBuildCommand(platform)}`,
      }
    }
    const imageExists =
      deps.imageExists ?? (async (name: string) => (await botImageState(name)) === "ready")
    if (!(await imageExists(image))) {
      return { kind: "refused", reason: botImageMissingText(image) }
    }
  }
  const join = deps.join ?? ((meeting, hooks) => createJoinAdapter().join(meeting, hooks))
  return new Promise<ProbeOutcome>((resolve) => {
    let settled = false
    const done = (outcome: ProbeOutcome) => {
      if (!settled) {
        settled = true
        resolve(outcome)
      }
    }
    void join(probeMeeting(url, platform), {
      onJoined: (info) =>
        done(
          info.mode === "stub"
            ? { kind: "refused", reason: stubReason(platform) }
            : { kind: "joined" },
        ),
      onWaitingRoom: () => done({ kind: "waiting_room" }),
    })
      // Хук входа не пришёл, а join закончился: это не вход.
      .then((result) =>
        done({
          kind: "refused",
          reason:
            result.mode === "stub"
              ? stubReason(platform)
              : "бот завершил работу, не сообщив о входе",
        }),
      )
      .catch((err: unknown) => {
        done({
          kind: "refused",
          reason: err instanceof Error ? err.message : String(err),
        })
      })
  })
}
