import type { Db } from "../db/index.ts";
import { APP_VERSION } from "../shared/version.ts";

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

export const MCP_TOOLS = [
  {
    name: "list_meetings",
    description: "Список встреч",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_meeting",
    description: "Одна встреча: транскрипт, резюме, задачи",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Идентификатор встречи" },
      },
      required: ["id"],
    },
  },
] as const;

export function parseJsonRpc(raw: string): JsonRpcRequest {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("пустой JSON-RPC запрос");
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON-RPC запрос должен быть объектом");
  }
  return parsed as JsonRpcRequest;
}

function toolText(payload: unknown, isError = false): {
  content: { type: "text"; text: string }[];
  isError: boolean;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
  };
}

function callTool(
  name: string,
  args: Record<string, unknown>,
  db: Db,
): { content: { type: "text"; text: string }[]; isError: boolean } {
  if (name === "list_meetings") {
    return toolText({ meetings: db.listMeetings() });
  }
  if (name === "get_meeting") {
    const id = typeof args.id === "string" ? args.id : "";
    if (!id) {
      return toolText({ error: "нужен id встречи" }, true);
    }
    const meeting = db.getMeeting(id);
    if (!meeting) {
      return toolText({ error: "встреча не найдена" }, true);
    }
    return toolText({
      meeting,
      transcript: db.listTranscript(id),
      summary: db.getSummary(id),
      actionItems: db.listActionItems(id),
    });
  }
  return toolText({ error: `неизвестный инструмент: ${name}` }, true);
}

export function handleJsonRpc(request: JsonRpcRequest, db: Db): JsonRpcResponse | null {
  const id = request.id === undefined ? null : request.id;
  const method = request.method ?? "";

  if (method.startsWith("notifications/")) {
    return null;
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "pm-assistant", version: APP_VERSION },
      },
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: MCP_TOOLS },
    };
  }

  if (method === "tools/call") {
    const params = (request.params ?? {}) as {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    const name = params.name ?? "";
    const args = params.arguments ?? {};
    return {
      jsonrpc: "2.0",
      id,
      result: callTool(name, args, db),
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `метод не найден: ${method}` },
  };
}
