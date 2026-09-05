import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SLIDES_UNAVAILABLE,
  unavailableSlides,
  type SlideSlot,
  type SlidesAdapter,
} from "./types.ts";

export {
  SLIDES_UNAVAILABLE,
  unavailableSlides,
  type SlideSlot,
  type SlidesAdapter,
  type SlidesCapture,
} from "./types.ts";

type DemoFixture = {
  slides: SlideSlot[];
};

export function loadDemoSlideSlots(): SlideSlot[] {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/demo-meeting.json",
  );
  const raw = JSON.parse(readFileSync(path, "utf8")) as DemoFixture;
  return raw.slides;
}

export function createSlidesAdapter(opts?: {
  slots?: SlideSlot[];
}): SlidesAdapter {
  const slots = opts?.slots ?? loadDemoSlideSlots();
  return {
    mode: "stub",
    captureAvailable: false,
    listSlots() {
      return slots;
    },
    async capture() {
      return unavailableSlides(slots);
    },
  };
}
