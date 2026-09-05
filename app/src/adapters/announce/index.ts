import type { JoinResult } from "../platform/index.ts";
import type { Meeting } from "../../shared/types.ts";

export const STUB_ANNOUNCEMENT_STATUS = "объявление (заглушка)";

export type JoinContext = {
  meeting: Meeting;
  join: JoinResult;
};

export function announceRecording(joinContext: JoinContext): void {
  const label =
    joinContext.join.mode === "stub"
      ? STUB_ANNOUNCEMENT_STATUS
      : "объявление отправлено";
  console.log(
    `${label}: встреча ${joinContext.meeting.id} (${joinContext.meeting.platform})`,
  );
}
