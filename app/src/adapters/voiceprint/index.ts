export const VOICEPRINT_UNAVAILABLE = "отпечаток не рассчитан";

export type VoiceprintInput = {
  speaker: string;
};

export type VoiceprintLabeled = {
  speaker: string;
  voiceprintLabel: string;
};

export type VoiceprintAdapter = {
  mode: "stub";
  modelAvailable: false;
  label(segments: VoiceprintInput[]): VoiceprintLabeled[];
};

export function speakerLabel(index: number): string {
  return `Спикер ${index}`;
}

export function createVoiceprintAdapter(): VoiceprintAdapter {
  return {
    mode: "stub",
    modelAvailable: false,
    label(segments) {
      const ranks = new Map<string, number>();
      let next = 1;
      return segments.map((segment) => {
        let rank = ranks.get(segment.speaker);
        if (rank === undefined) {
          rank = next;
          next += 1;
          ranks.set(segment.speaker, rank);
        }
        return {
          speaker: speakerLabel(rank),
          voiceprintLabel: VOICEPRINT_UNAVAILABLE,
        };
      });
    },
  };
}
