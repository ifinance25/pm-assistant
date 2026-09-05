import { getDb } from "../db/index.ts";
import { processJob } from "./pipeline.ts";

const meetingId = process.argv[2]?.trim() ?? "";
if (!meetingId) {
  console.error("usage: node src/worker/transcribe-cli.ts <meetingId>");
  process.exit(1);
}

const db = getDb();
const meeting = db.getMeeting(meetingId);
if (!meeting) {
  console.error(`встреча ${meetingId} не найдена`);
  process.exit(1);
}
if (!meeting.audioPath) {
  console.error(`у встречи ${meetingId} нет audio_path`);
  process.exit(1);
}

console.log(
  `расшифровка ${meetingId} файл=${meeting.audioPath} статус=${meeting.status}`,
);

await processJob(db, {
  id: `cli-transcribe-${meetingId}`,
  meetingId,
  type: "transcribe",
  status: "running",
  attempts: 1,
  lastError: null,
  claimedAt: new Date().toISOString(),
  createdAt: null,
});

const done = db.getMeeting(meetingId);
const segments = db.listTranscript(meetingId);
console.log(
  `готово статус=${done?.status ?? "?"} сегментов=${segments.length}`,
);
if (segments[0]?.text) {
  console.log(segments[0].text.slice(0, 240));
}
db.close();
