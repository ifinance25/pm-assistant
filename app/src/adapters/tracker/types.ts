import type { TrackerType } from "../../shared/types.ts";

export type TrackerTaskInput = {
  id: string;
  title: string;
  assignee: string | null;
  dueAt: string | null;
};

export type TrackerDispatchMode = "queued" | "created";

export type TrackerDispatchResult = {
  mode: TrackerDispatchMode;
  notice: string;
  itemIds: string[];
};

export type TrackerAdapter = {
  trackerType: TrackerType;
  hasConnection: boolean;
  createTasks(items: TrackerTaskInput[]): Promise<TrackerDispatchResult>;
};

const TRACKER_LABELS: Record<TrackerType, string> = {
  asana: "Asana",
  trello: "Trello",
  clickup: "ClickUp",
  notion: "Notion",
};

function stubNotice(type: TrackerType, connected: boolean): string {
  const label = TRACKER_LABELS[type];
  if (!connected) {
    return `Подключите ${label} в Настройках. Задачи помечены к созданию.`;
  }
  return `Задачи помечены к созданию в ${label} (заглушка).`;
}

export function createTrackerAdapter(
  trackerType: TrackerType,
  connected: boolean,
): TrackerAdapter {
  return {
    trackerType,
    hasConnection: connected,
    async createTasks(items) {
      return {
        mode: "queued",
        notice: stubNotice(trackerType, connected),
        itemIds: items.map((item) => item.id),
      };
    },
  };
}
