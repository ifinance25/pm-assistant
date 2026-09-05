import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function run(command: string, args: string[]): ChildProcess {
  return spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

const api = run(process.execPath, ["src/server/index.ts"]);
const web = run(process.execPath, ["node_modules/vite/bin/vite.js"]);

function stop(): void {
  api.kill();
  web.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

api.on("exit", (code) => {
  if (code && code !== 0) {
    web.kill();
    process.exit(code);
  }
});
