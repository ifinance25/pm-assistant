export const SLIDES_UNAVAILABLE = "захват недоступен";

export type SlideSlot = {
  id: string;
  title: string;
  capturedAtMs: number;
};

export type SlidesCapture = {
  mode: "stub";
  captureAvailable: false;
  notice: typeof SLIDES_UNAVAILABLE;
  slots: SlideSlot[];
};

export type SlidesAdapter = {
  mode: "stub";
  captureAvailable: false;
  listSlots(): SlideSlot[];
  capture(): Promise<SlidesCapture>;
};

export function unavailableSlides(slots: SlideSlot[]): SlidesCapture {
  return {
    mode: "stub",
    captureAvailable: false,
    notice: SLIDES_UNAVAILABLE,
    slots,
  };
}
