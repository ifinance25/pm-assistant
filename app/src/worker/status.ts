import type { MeetingStatus } from "../shared/types.ts";

const ALLOWED: Record<MeetingStatus, MeetingStatus[]> = {
  queued: ["joining", "transcribing", "error"],
  joining: ["recording", "transcribing", "error"],
  recording: ["transcribing", "error"],
  transcribing: ["summarizing", "error"],
  summarizing: ["ready", "transcribing", "error"],
  ready: ["transcribing", "error"],
  error: ["queued", "transcribing"],
};

export function assertStatusTransition(
  from: MeetingStatus,
  to: MeetingStatus,
): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`недопустимый переход статуса: ${from} -> ${to}`);
  }
}
