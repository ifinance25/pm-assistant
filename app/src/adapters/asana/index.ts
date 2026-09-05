import type { ActionItem } from "../../shared/types.ts";
import type { Db } from "../../db/index.ts";
import { fetchWithTimeout, isAbortError } from "../../shared/http-timeout.ts";

export const ASANA_TASKS_URL = "https://app.asana.com/api/1.0/tasks";

export type AsanaDispatchMode = "queued" | "sent";

export type AsanaTaskInput = {
  id: string;
  title: string;
  assignee: string | null;
  dueAt: string | null;
};

export type AsanaDispatchResult = {
  mode: AsanaDispatchMode;
  notice: string;
  itemIds: string[];
  sentIds?: string[];
  sentItems?: Array<{ id: string; externalId: string | null }>;
};

export type AsanaAdapter = {
  hasToken: boolean;
  dispatch(items: AsanaTaskInput[]): Promise<AsanaDispatchResult>;
};

const NO_TOKEN_NOTICE =
  "Нет ключа ASANA_PAT. Задачи помечены к отправке.";
const SENT_NOTICE = "Задачи отправлены в Asana.";
const FAIL_NOTICE =
  "Не удалось отправить в Asana. Задачи помечены к отправке.";
const PARTIAL_NOTICE =
  "Часть задач отправлена в Asana, остальные помечены к отправке.";

export function resolveAsanaPat(explicit?: string | null): string {
  const raw = explicit !== undefined ? explicit : process.env.ASANA_PAT;
  return raw?.trim() ?? "";
}

function taskPayload(item: AsanaTaskInput, projectGid: string) {
  const data: Record<string, unknown> = {
    name: item.title,
  };
  if (item.assignee) {
    data.notes = `Ответственный: ${item.assignee}`;
  }
  if (item.dueAt) {
    data.due_on = item.dueAt.slice(0, 10);
  }
  if (projectGid) {
    data.projects = [projectGid];
  }
  return { data };
}

export function createAsanaAdapter(opts?: {
  token?: string | null;
  projectGid?: string;
  fetchImpl?: typeof fetch;
}): AsanaAdapter {
  const token = resolveAsanaPat(opts?.token);
  const projectGid = opts?.projectGid?.trim() ?? "";
  const fetchImpl = opts?.fetchImpl ?? fetchWithTimeout;

  if (!token) {
    return {
      hasToken: false,
      async dispatch(items) {
        return {
          mode: "queued",
          notice: NO_TOKEN_NOTICE,
          itemIds: items.map((item) => item.id),
        };
      },
    };
  }

  return {
    hasToken: true,
    async dispatch(items) {
      const sentItems: Array<{ id: string; externalId: string | null }> = [];
      const queued: string[] = [];
      let failed = false;
      for (const item of items) {
        if (failed) {
          queued.push(item.id);
          continue;
        }
        try {
          const response = await fetchImpl(ASANA_TASKS_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(taskPayload(item, projectGid)),
          });
          if (!response.ok) {
            failed = true;
            queued.push(item.id);
            continue;
          }
          const body = (await response.json()) as { data?: { gid?: string } };
          sentItems.push({
            id: item.id,
            externalId: body.data?.gid ?? null,
          });
        } catch (err) {
          if (isAbortError(err) || err) {
            failed = true;
            queued.push(item.id);
          }
        }
      }
      if (sentItems.length === items.length) {
        return {
          mode: "sent",
          notice: SENT_NOTICE,
          itemIds: sentItems.map((row) => row.id),
          sentIds: sentItems.map((row) => row.id),
          sentItems,
        };
      }
      return {
        mode: "queued",
        notice: sentItems.length ? PARTIAL_NOTICE : FAIL_NOTICE,
        itemIds: queued,
        sentIds: sentItems.map((row) => row.id),
        sentItems,
      };
    },
  };
}

export async function dispatchActionItems(
  db: Db,
  items: ActionItem[],
  opts?: {
    token?: string | null;
    projectGid?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<AsanaDispatchResult> {
  const ids = items.map((item) => item.id);
  if (ids.length === 0) {
    return { mode: "queued", notice: NO_TOKEN_NOTICE, itemIds: [] };
  }
  const adapter = createAsanaAdapter({
    token: opts?.token,
    projectGid: opts?.projectGid ?? db.getSettings().asanaProjectLabel,
    fetchImpl: opts?.fetchImpl,
  });
  const result = await adapter.dispatch(items);
  if (result.sentItems?.length) {
    db.markActionItemsCreated(result.sentItems, "asana");
  }
  if (result.itemIds.length && result.mode === "queued") {
    db.markActionItemsQueued(result.itemIds, "asana");
  }
  return result;
}

export async function maybeAutoSendAsana(
  db: Db,
  meetingId: string,
  opts?: {
    token?: string | null;
    fetchImpl?: typeof fetch;
  },
): Promise<AsanaDispatchResult | null> {
  if (!db.getSettings().asanaAutoSend) {
    return null;
  }
  const pending = db
    .listActionItems(meetingId)
    .filter((item) => item.asanaState === "none");
  if (pending.length === 0) {
    return null;
  }
  return dispatchActionItems(db, pending, opts);
}
