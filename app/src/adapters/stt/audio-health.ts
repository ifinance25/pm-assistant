import { runFfmpeg, whichFfmpeg } from "./trim-silence.ts";

export type Loudness = {
  meanDb: number;
  maxDb: number;
};

/** Ниже этого уровня средней громкости в файле нет речи: бот записал тишину. */
export const SILENT_MEAN_DB = -60;

export function parseVolumedetect(log: string): Loudness | null {
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(log);
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(log);
  if (!mean || !max) {
    return null;
  }
  return { meanDb: Number(mean[1]), maxDb: Number(max[1]) };
}

export async function measureLoudness(
  audioPath: string,
  ffmpegBin = whichFfmpeg(),
): Promise<Loudness | null> {
  if (!ffmpegBin) {
    return null;
  }
  const result = await runFfmpeg(ffmpegBin, [
    "-i",
    audioPath,
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  return parseVolumedetect(result.stderr);
}
