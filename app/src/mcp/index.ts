import { getDb } from "../db/index.ts";
import { handleJsonRpc, parseJsonRpc } from "./protocol.ts";

const db = getDb();

function writeMessage(payload: object): void {
  const json = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
  process.stdout.write(header + json);
}

function takeMessage(buffer: string): { raw: string; rest: string } | null {
  const header = buffer.match(/^Content-Length:\s*(\d+)\r?\n\r?\n/);
  if (header) {
    const length = Number(header[1]);
    const start = header[0].length;
    if (buffer.length < start + length) {
      return null;
    }
    return {
      raw: buffer.slice(start, start + length),
      rest: buffer.slice(start + length),
    };
  }
  if (buffer.startsWith("{")) {
    const nl = buffer.indexOf("\n");
    if (nl === -1) {
      return null;
    }
    return { raw: buffer.slice(0, nl), rest: buffer.slice(nl + 1) };
  }
  const skip = buffer.search(/Content-Length:|{/);
  if (skip > 0) {
    return takeMessage(buffer.slice(skip));
  }
  return null;
}

function handleRaw(raw: string): void {
  let request;
  try {
    request = parseJsonRpc(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeMessage({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message },
    });
    return;
  }
  const response = handleJsonRpc(request, db);
  if (response) {
    writeMessage(response);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let taken = takeMessage(buffer);
  while (taken) {
    buffer = taken.rest;
    handleRaw(taken.raw);
    taken = takeMessage(buffer);
  }
});

process.stderr.write(
  "MCP pm-assistant: stdio JSON-RPC, инструменты list_meetings и get_meeting\n",
);
