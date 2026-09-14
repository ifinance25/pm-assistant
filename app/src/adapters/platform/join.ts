import type { Meeting, Platform } from "../../shared/types.ts";
import { hasMeetBotRuntime, joinMeetMeeting } from "./meet-bot.ts";
import { joinZoomMeeting, hasZoomSdkCredentials } from "./zoom-bot.ts";

export type JoinResult = {
  mode: "live" | "stub";
  audioPath: string | null;
};

export type JoinHooks = {
  onJoined?: (info: { mode: "live" | "stub" }) => void | Promise<void>;
  onWaitingRoom?: () => void | Promise<void>;
};

export type JoinAdapter = {
  join(meeting: Meeting, hooks?: JoinHooks): Promise<JoinResult>;
};

export const MEET_NOT_IMPLEMENTED =
  "Google Meet пока не реализован";
export const TELEMOST_NOT_IMPLEMENTED =
  "Яндекс.Телемост пока не реализован";
export const ZOOM_NOT_CONFIGURED =
  "Zoom-бот не настроен: нет ZOOM_CLIENT_ID";
export const PLATFORM_UNKNOWN = "Платформа ссылки не распознана";

export const ZoomAdapter: JoinAdapter = {
  async join(meeting, hooks) {
    if (!hasZoomSdkCredentials()) {
      throw new Error(ZOOM_NOT_CONFIGURED);
    }
    return joinZoomMeeting(meeting, {
      onJoined: hooks?.onJoined,
      onWaitingRoom: hooks?.onWaitingRoom,
    });
  },
};

export const MeetAdapter: JoinAdapter = {
  async join(meeting, hooks) {
    if (!hasMeetBotRuntime()) {
      throw new Error(MEET_NOT_IMPLEMENTED);
    }
    return joinMeetMeeting(meeting, {
      onJoined: hooks?.onJoined,
      onWaitingRoom: hooks?.onWaitingRoom,
    });
  },
};

export const TelemostAdapter: JoinAdapter = {
  async join() {
    throw new Error(TELEMOST_NOT_IMPLEMENTED);
  },
};

export const UnknownAdapter: JoinAdapter = {
  async join() {
    throw new Error(PLATFORM_UNKNOWN);
  },
};

/**
 * Какой бот за какой платформой. Таблица, а не цепочка `if`: новая платформа
 * меняет одну строку, поэтому ветки платформ сливаются без конфликта.
 */
export const JOIN_ADAPTERS: Record<Platform, JoinAdapter> = {
  zoom: ZoomAdapter,
  meet: MeetAdapter,
  telemost: TelemostAdapter,
  unknown: UnknownAdapter,
};

export function createJoinAdapter(): JoinAdapter {
  return {
    async join(meeting: Meeting, hooks?: JoinHooks): Promise<JoinResult> {
      const adapter = JOIN_ADAPTERS[meeting.platform] ?? UnknownAdapter;
      return adapter.join(meeting, hooks);
    },
  };
}
