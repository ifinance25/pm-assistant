import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { getDb } from "../db/index.ts";

getDb();

const hostname = "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, hostname, port }, () => {
  console.log(`API слушает http://${hostname}:${port}`);
});
