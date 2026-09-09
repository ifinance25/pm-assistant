import { basename, dirname, join } from "node:path";

/**
 * Имя файла звука всегда `<meetingId>.<ext>` (см. meetingAudioFile в zoom-bot.ts),
 * а после normalizeMeetingAudio — `<meetingId>.speech.wav`. Отсюда же выводим
 * пути к таймлайну спикеров и смещению после срезки тишины.
 */
export function meetingIdFromAudioPath(audioPath: string): string {
  return basename(audioPath).replace(/(\.speech)?\.(wav|webm|mp3|m4a)$/i, "");
}

export function speakersTimelinePath(audioPath: string): string {
  return join(
    dirname(audioPath),
    `${meetingIdFromAudioPath(audioPath)}.speakers.json`,
  );
}

export function trimOffsetPath(audioPath: string): string {
  return join(
    dirname(audioPath),
    `${meetingIdFromAudioPath(audioPath)}.trim-offset.json`,
  );
}
