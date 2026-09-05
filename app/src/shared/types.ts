export type Platform = "zoom" | "meet" | "telemost" | "unknown";

export type MeetingStatus =
  | "queued"
  | "joining"
  | "recording"
  | "transcribing"
  | "summarizing"
  | "ready"
  | "error";

export type RecordingMode = "text" | "local_audio" | "full";

export type MeetingSource = "live" | "stub";

export type TrackerType = "asana" | "trello" | "clickup" | "notion";

export const TRACKER_TYPES: TrackerType[] = [
  "asana",
  "trello",
  "clickup",
  "notion",
];

export const TRACKER_LABELS: Record<TrackerType, string> = {
  asana: "Asana",
  trello: "Trello",
  clickup: "ClickUp",
  notion: "Notion",
};

export function isTrackerType(value: string): value is TrackerType {
  return (TRACKER_TYPES as string[]).includes(value);
}

export type TrackerState = "none" | "queued" | "created";

/** @deprecated используйте trackerState */
export type AsanaState = "none" | "queued_for_asana" | "sent";

export type Project = {
  id: string;
  name: string;
  trackerProjectRef: string;
  trackerParentRef: string;
  meetingCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type UserRole = "admin" | "user";

export type User = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

export type SessionInfo = {
  user: User;
  integrations: {
    tracker: TrackerType;
    trackerConnected: boolean;
    googleCalendar: boolean;
  };
};

export type Meeting = {
  id: string;
  url: string;
  platform: Platform;
  title: string | null;
  status: MeetingStatus;
  recordingMode: RecordingMode;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
  announcementStatus: string | null;
  source: MeetingSource;
  audioPath: string | null;
  projectId?: string | null;
  ownerUserId?: string | null;
};

export type CreateMeetingInput = {
  url: string;
  platform?: Platform;
  title?: string | null;
  recordingMode?: RecordingMode;
  source?: MeetingSource;
  projectId?: string | null;
  ownerUserId?: string | null;
};

export type TranscriptSegment = {
  id: string;
  meetingId: string;
  speaker: string;
  startedAtMs: number;
  endedAtMs: number | null;
  text: string;
  voiceprintLabel?: string;
};

export type Summary = {
  meetingId: string;
  headline: string;
  decisions: string;
  risks: string;
  nextStep: string;
};

export type ActionItem = {
  id: string;
  meetingId: string;
  assignee: string | null;
  title: string;
  dueAt: string | null;
  timecodeMs: number | null;
  segmentId: string | null;
  trackerType: TrackerType | null;
  trackerState: TrackerState;
  trackerExternalId: string | null;
  /** @deprecated используйте trackerState */
  asanaState: AsanaState;
};

export type Settings = {
  recordingModeDefault: RecordingMode;
  trackerType: TrackerType;
  asanaProjectLabel: string;
  asanaAutoSend: boolean;
  webhookUrl: string;
  workerHeartbeatAt: string | null;
};

export type WebhookDeliveryStatus = "delivered" | "skipped" | "failed";

export type WebhookDelivery = {
  id: string;
  meetingId: string;
  url: string;
  status: WebhookDeliveryStatus;
  detail: string;
  createdAt: string;
};

export type Job = {
  id: string;
  meetingId: string;
  type: string;
  status: string;
  attempts: number;
  lastError: string | null;
  claimedAt: string | null;
};

export type RealtimeCaption = "живой" | "заглушка realtime";

export type RealtimeInfo = {
  mode: MeetingSource;
  caption: RealtimeCaption;
};

export function realtimeCaption(mode: MeetingSource): RealtimeCaption {
  return mode === "live" ? "живой" : "заглушка realtime";
}

export function trackerStateToAsanaState(state: TrackerState): AsanaState {
  if (state === "queued") {
    return "queued_for_asana";
  }
  if (state === "created") {
    return "sent";
  }
  return "none";
}

export type MeetingDetail = {
  meeting: Meeting;
  transcript: TranscriptSegment[];
  summary: Summary | null;
  actionItems: ActionItem[];
  realtime?: RealtimeInfo;
};

export type SearchMeetingsFilters = {
  platform?: Platform;
  period?: string;
};

export type HealthResponse = {
  ok: true;
  workerAlive: boolean;
  workerHeartbeatAt: string | null;
};
