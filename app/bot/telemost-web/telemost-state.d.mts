// Типы для telemost-state.mjs: tsc проверяет тесты в src, которые его импортируют.

export declare const LOG_PREFIX: "PM_BOT_"
export declare const TELEMOST_ENV: {
  meetingUrl: string
  botName: string
  audioPath: string
  headless: string
  channel: string
}
export declare const DEFAULT_BOT_NAME: string
export declare const TAB_CAPTURE_TITLE: string
export declare const TELEMOST_TIMEOUTS: { joinMs: number; waitingRoomMs: number; maxMs: number }
export declare const DEADLINE_MARGIN_MS: { join: number; waitingRoom: number; max: number }
export declare const AUTH_STABLE_MS: number

export type TelemostFailureCode =
  | "unexpected"
  | "bad_url"
  | "browser"
  | "page"
  | "stopped"
  | "join_timeout"
  | "auth_required"
  | "rejected"
  | "waiting_room_timeout"
  | "not_found"

export declare const TELEMOST_FAILURES: Record<TelemostFailureCode, { exitCode: number; text: string }>
export declare const STEP_TEXT: Record<string, string>

export type TelemostConfig = {
  meetingUrl: string | null
  botName: string
  audioPath: string
  headless: boolean
  channel: string
}

export declare function normalizeMeetingUrl(raw: unknown): string | null
export declare function readTelemostConfig(env?: Record<string, string | undefined>): TelemostConfig
export declare function logSafe(text: unknown): string
export declare function failureExitCode(code: string): number
export declare function failureLine(code: string, step?: string): string
export declare function failCodeLine(code: string): string
export declare function failStepLine(step: string): string
export declare function stepLine(step: string): string
export declare function waitingRoomLine(): string
export declare function joinedLine(): string
export declare function screenshotLine(path: string): string
export declare function logLine(text: unknown): string

export type EndedReason = "ui" | "call_ui_gone" | "signal" | "page_closed" | "timeout" | "error"
export declare const ENDED_REASONS: EndedReason[]
export declare function endedLine(reason: string): string

export declare const TELEMOST_RE: Record<
  | "continueInBrowser"
  | "joinButton"
  | "nameField"
  | "cameraOn"
  | "dismiss"
  | "leaveButton"
  | "callControls"
  | "waitingRoom"
  | "rejected"
  | "notFound"
  | "authText"
  | "ended",
  RegExp
>

/** Снимок экрана из join.mjs. */
export type TelemostScreen = {
  url?: string
  text?: string
  hasContinue?: boolean
  hasName?: boolean
  hasJoin?: boolean
  hasLeave?: boolean
  hasControls?: boolean
}

export type TelemostScreenState =
  | "auth_required"
  | "joined"
  | "rejected"
  | "not_found"
  | "waiting_room"
  | "auth_text"
  | "guest_flow"

export declare function classifyTelemostScreen(screen: TelemostScreen): TelemostScreenState

export type EntryObservation = {
  state: TelemostScreenState | "done"
  lines: string[]
  outcome: "joined" | TelemostFailureCode | null
}

export declare function createEntryTracker(options: {
  startedAt: number
  now?: () => number
  timeouts?: { joinMs: number; waitingRoomMs: number; maxMs: number }
}): { observe(screen: TelemostScreen): EntryObservation }

export declare function callDeadline(
  joinedAt: number,
  timeouts?: { joinMs: number; waitingRoomMs: number; maxMs: number },
): number
