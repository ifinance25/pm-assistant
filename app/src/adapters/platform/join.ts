import type { Meeting } from "../../shared/types.ts";
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
  async join() {
    throw new Error(MEET_NOT_IMPLEMENTED);
  },
};

export const TelemostAdapter: JoinAdapter = {
  async join() {
    throw new Error(TELEMOST_NOT_IMPLEMENTED);
  },
};

export function createJoinAdapter(): JoinAdapter {
  return {
    async join(meeting: Meeting, hooks?: JoinHooks): Promise<JoinResult> {
      if (meeting.platform === "zoom") {
        return ZoomAdapter.join(meeting, hooks);
      }
      if (meeting.platform === "meet") {
        return MeetAdapter.join(meeting, hooks);
      }
      return TelemostAdapter.join(meeting, hooks);
    },
  };
}
