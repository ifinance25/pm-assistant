import type { MeetingStatus } from "../shared/types.ts";

const ALLOWED: Record<MeetingStatus, MeetingStatus[]> = {
  queued: ["joining", "transcribing", "error"],
  joining: ["waiting_room", "recording", "transcribing", "error"],
  waiting_room: ["recording", "transcribing", "error"],
  recording: ["transcribing", "error"],
  transcribing: ["summarizing", "error"],
  summarizing: ["ready", "transcribing", "error"],
  ready: ["transcribing", "summarizing", "error"],
  error: ["queued", "transcribing", "summarizing"],
};

export function assertStatusTransition(
  from: MeetingStatus,
  to: MeetingStatus,
): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`недопустимый переход статуса: ${from} -> ${to}`);
  }
}
