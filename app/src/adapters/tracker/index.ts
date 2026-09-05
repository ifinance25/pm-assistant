import type { ActionItem, TrackerType } from "../../shared/types.ts";
import type { Db } from "../../db/index.ts";
import { createAsanaAdapter } from "../asana/index.ts";
import {
  createTrackerAdapter,
  type TrackerDispatchResult,
} from "./types.ts";

export function isTrackerConnected(db: Db, trackerType: TrackerType): boolean {
  if (trackerType === "asana") {
    return Boolean(process.env.ASANA_PAT?.trim()) || db.isIntegrationConnected("tracker:asana");
  }
  return db.isIntegrationConnected(`tracker:${trackerType}`);
}

export async function dispatchTrackerActionItems(
  db: Db,
  items: ActionItem[],
  trackerType: TrackerType,
): Promise<TrackerDispatchResult> {
  const ids = items.map((item) => item.id);
  if (ids.length === 0) {
    return {
      mode: "queued",
      notice: "Нет задач для отправки.",
      itemIds: [],
    };
  }

  if (trackerType === "asana" && process.env.ASANA_PAT?.trim()) {
    const adapter = createAsanaAdapter({
      token: process.env.ASANA_PAT,
      projectGid: db.getSettings().asanaProjectLabel,
    });
    const result = await adapter.dispatch(
      items.map((item) => ({
        id: item.id,
        title: item.title,
        assignee: item.assignee,
        dueAt: item.dueAt,
      })),
    );
    if (result.sentItems?.length) {
      db.markActionItemsCreated(result.sentItems, "asana");
    }
    if (result.mode === "queued" && result.itemIds.length) {
      db.markActionItemsQueued(result.itemIds, "asana");
    }
    return {
      mode: result.sentItems?.length && result.itemIds.length === 0 ? "created" : "queued",
      notice: result.notice,
      itemIds: result.sentItems?.length === items.length ? ids : result.itemIds,
    };
  }

  const adapter = createTrackerAdapter(trackerType, false);
  const result = await adapter.createTasks(
    items.map((item) => ({
      id: item.id,
      title: item.title,
      assignee: item.assignee,
      dueAt: item.dueAt,
    })),
  );
  db.markActionItemsQueued(ids, trackerType);
  return { ...result, mode: "queued" };
}

export async function maybeAutoSendTracker(
  db: Db,
  meetingId: string,
): Promise<TrackerDispatchResult | null> {
  if (!db.getSettings().asanaAutoSend) {
    return null;
  }
  const pending = db
    .listActionItems(meetingId)
    .filter((item) => item.trackerState === "none");
  if (pending.length === 0) {
    return null;
  }
  return dispatchTrackerActionItems(
    db,
    pending,
    db.getSettings().trackerType,
  );
}

export { createTrackerAdapter } from "./types.ts";
export type {
  TrackerAdapter,
  TrackerDispatchResult,
  TrackerTaskInput,
} from "./types.ts";
