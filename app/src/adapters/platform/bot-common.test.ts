import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { parseBotAudioLine } from "./bot-runtime.ts"

/**
 * `bot/common` подключается контейнером любой платформы без правок. Браузер и
 * Docker здесь не поднимаются: проверяется приём кусков звука и строка в stdout,
 * по которой рантайм находит файл.
 */
const commonDir = join(dirname(fileURLToPath(import.meta.url)), "../../../bot/common")

afterEach(() => {
  vi.restoreAllMocks()
})

describe("bot/common", () => {
  it("пишет куски звука в файл и печатает PM_BOT_AUDIO_SAVED:<путь>", async () => {
    // Путь переменной: модуль на JS, без объявлений типов для tsc.
    const sinkUrl = new URL(`file://${join(commonDir, "audio-sink.mjs")}`).href
    const sink = await import(sinkUrl)
    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
    const audioPath = join(mkdtempSync(join(tmpdir(), "pm-bot-common-")), "m1.webm")
    const writer = sink.createAudioWriter(audioPath)
    writer.append(Buffer.from("a".repeat(100)).toString("base64"))
    writer.append(Buffer.from("b".repeat(100)).toString("base64"))
    const saved = await sink.finalizeAudio(audioPath, writer)
    const line = lines.find((text) => text.startsWith("PM_BOT_AUDIO_SAVED:"))
    expect(line).toBe(`PM_BOT_AUDIO_SAVED:${saved}`)
    expect(parseBotAudioLine(`${line}\n`)).toBe(saved)
    expect(existsSync(saved)).toBe(true)
    // Опоздавший кусок после закрытия файл не пересоздаёт.
    writer.append(Buffer.from("c").toString("base64"))
    expect(lines.some((text) => /ZOOM/.test(text))).toBe(false)
  })

  it("перехват звука в странице без имён Zoom", () => {
    const capture = readFileSync(join(commonDir, "capture-audio.js"), "utf8")
    expect(capture).not.toMatch(/zoom/i)
    const sink = readFileSync(join(commonDir, "audio-sink.mjs"), "utf8")
    expect(sink).not.toMatch(/zoom/i)
  })
})
