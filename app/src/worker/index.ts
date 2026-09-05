import { getDb } from "../db/index.ts";
import { recoverOrphanedWork } from "./recover.ts";
import { runOnce } from "./pipeline.ts";

const HEARTBEAT_MS = 5_000;
const POLL_MS = 500;
const db = getDb();

function beat(): void {
  db.putSettings({ workerHeartbeatAt: new Date().toISOString() });
}

const recovered = recoverOrphanedWork(db);
console.error(
  `воркер: снято running ${recovered.jobsFailed}, join с wav ${recovered.joinJobsFailed}, в расшифровку ${recovered.transcribeQueued}, без звука ${recovered.meetingsErrored}, дубликаты ${recovered.extraJobsFailed}`,
);

beat();
setInterval(beat, HEARTBEAT_MS);

async function loop(): Promise<void> {
  try {
    await runOnce(db);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`воркер: ошибка задания: ${message}`);
  }
}

void loop();
void loop();
void loop();
setInterval(() => {
  void loop();
}, POLL_MS);

console.log("Воркер запущен. Задания из SQLite, heartbeat в настройки.");
