export const TRANSCRIPT_BLOCK_MAX_CHARS = 1000;

export type TranscriptChunk = {
  speaker: string;
  startedAtMs: number;
  endedAtMs: number | null;
  text: string;
};

export type TranscriptBlock<T extends TranscriptChunk = TranscriptChunk> = {
  speaker: string;
  startedAtMs: number;
  endedAtMs: number | null;
  text: string;
  parts: T[];
};

const SENTENCE_RE = /[^.!?…]+(?:[.!?…]+["»”']*)?(?:\s+|$)/gu;

export function groupTranscriptSegments<T extends TranscriptChunk>(
  segments: T[],
  maxChars = TRANSCRIPT_BLOCK_MAX_CHARS,
): TranscriptBlock<T>[] {
  const blocks: TranscriptBlock<T>[] = [];
  for (const run of speakerRuns(segments)) {
    blocks.push(...packRun(run, maxChars));
  }
  return blocks;
}

function speakerRuns<T extends TranscriptChunk>(segments: T[]): T[][] {
  const runs: T[][] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) {
      continue;
    }
    const current = { ...segment, text };
    const last = runs.at(-1);
    if (last?.[0]?.speaker === current.speaker) {
      last.push(current);
    } else {
      runs.push([current]);
    }
  }
  return runs;
}

function packRun<T extends TranscriptChunk>(
  parts: T[],
  maxChars: number,
): TranscriptBlock<T>[] {
  const merged = parts.map((part) => part.text).join(" ");
  const packed = packSentences(splitSentences(merged), maxChars);
  const spans = charSpans(parts);
  let cursor = 0;
  return packed.map((text) => {
    const from = merged.indexOf(text, cursor);
    const start = from === -1 ? cursor : from;
    const end = start + text.length;
    cursor = end;
    const overlapping = spans
      .filter((span) => span.start < end && span.end > start)
      .map((span) => span.part);
    const used = overlapping.length > 0 ? overlapping : [parts[0]!];
    return {
      speaker: parts[0]!.speaker,
      startedAtMs: used[0]!.startedAtMs,
      endedAtMs: used.at(-1)?.endedAtMs ?? null,
      text,
      parts: used,
    };
  });
}

function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let last = 0;
  for (const match of text.matchAll(SENTENCE_RE)) {
    sentences.push(match[0]);
    last = (match.index ?? 0) + match[0].length;
  }
  if (last < text.length) {
    sentences.push(text.slice(last));
  }
  return sentences.filter((sentence) => sentence.length > 0);
}

function packSentences(sentences: string[], maxChars: number): string[] {
  const blocks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? current + sentence : sentence;
    if (current && next.length > maxChars) {
      blocks.push(current.trim());
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current.trim()) {
    blocks.push(current.trim());
  }
  return blocks;
}

function charSpans<T extends TranscriptChunk>(
  parts: T[],
): { part: T; start: number; end: number }[] {
  const spans: { part: T; start: number; end: number }[] = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    const start = offset;
    const end = start + part.text.length;
    spans.push({ part, start, end });
    offset = end + (i < parts.length - 1 ? 1 : 0);
  }
  return spans;
}

export function flattenTranscriptBlocks<T extends TranscriptChunk>(
  blocks: TranscriptBlock<T>[],
): T[] {
  return blocks.map((block) => ({
    ...block.parts[0]!,
    speaker: block.speaker,
    startedAtMs: block.startedAtMs,
    endedAtMs: block.endedAtMs,
    text: block.text,
  }));
}

export function frameScrollTopForTarget(
  frameTop: number,
  frameScrollTop: number,
  targetTop: number,
): number {
  return Math.max(0, frameScrollTop + (targetTop - frameTop));
}
