import { describe, expect, it } from "vitest"
import {
  audioFileIfPresent,
  meetingAudioFile,
  parseAudioSavedLine,
  ZOOM_BOT_IMAGE_DEFAULT,
  ZOOM_BOT_ROLE_LABEL,
  zoomBotDockerRunArgs,
} from "./zoom-bot.ts"

describe("zoom bot audio helpers", () => {
  it("разбирает ZOOM_BOT_AUDIO_SAVED и игнорирует пустой путь", () => {
    expect(
      parseAudioSavedLine("ZOOM_BOT_JOINED\nZOOM_BOT_AUDIO_SAVED:/tmp/a.webm\n"),
    ).toBe("/tmp/a.webm")
    expect(parseAudioSavedLine("ZOOM_BOT_AUDIO_SAVED:\n")).toBeNull()
    expect(parseAudioSavedLine("нет метки")).toBeNull()
  })

  it("кладёт файл в data/audio/<id>.webm", () => {
    expect(meetingAudioFile("abc-123", "webm", "/app")).toBe(
      "/app/data/audio/abc-123.webm",
    )
  })

  it("отбрасывает отсутствующий файл", () => {
    expect(audioFileIfPresent("/tmp/pm-assistant-missing-audio.webm")).toBeNull()
    expect(audioFileIfPresent(null)).toBeNull()
  })
})

describe("zoomBotDockerRunArgs", () => {
  it("вешает метку роли zoom-bot на docker run", () => {
    const args = zoomBotDockerRunArgs(
      ZOOM_BOT_IMAGE_DEFAULT,
      "/tmp/audio",
      "/audio/m.webm",
    )
    expect(args).toContain("--label")
    expect(args).toContain(ZOOM_BOT_ROLE_LABEL)
    expect(args[args.length - 1]).toBe(ZOOM_BOT_IMAGE_DEFAULT)
  })
})
