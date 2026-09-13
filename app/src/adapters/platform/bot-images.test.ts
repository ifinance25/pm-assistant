import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  botBuildCommand,
  botImageMissingText,
  botImageName,
  botImageSpecs,
  dockerBuildArgs,
} from "./bot-images.ts"

describe("образы ботов", () => {
  it("собирает Zoom из bot/zoom-web/Dockerfile с контекстом bot", () => {
    const zoom = botImageSpecs("zoom")
    expect(zoom).toHaveLength(1)
    expect(dockerBuildArgs(zoom[0], "pm-assistant-zoom-bot")).toEqual([
      "build",
      "-f",
      "bot/zoom-web/Dockerfile",
      "-t",
      "pm-assistant-zoom-bot",
      "bot",
    ])
  })

  it("без платформы отдаёт все известные образы", () => {
    const all = botImageSpecs()
    expect(all.length).toBeGreaterThanOrEqual(1)
    expect(all.map((spec) => spec.platform)).toContain("zoom")
  })

  it("имя образа берёт из окружения, иначе по умолчанию", () => {
    expect(botImageName("zoom", { ZOOM_BOT_IMAGE: "мой-образ" })).toBe("мой-образ")
    expect(botImageName("zoom", {})).toBe("pm-assistant-zoom-bot")
    expect(botImageName("unknown", {})).toBeNull()
  })

  it("подсказывает команду сборки по платформе", () => {
    expect(botBuildCommand("zoom")).toBe("npm run bot:build:zoom")
    expect(botBuildCommand("unknown")).toBeNull()
  })

  it("никогда не называет скрипт, которого нет в package.json", () => {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../package.json"), "utf8"),
    ) as { scripts: Record<string, string> }
    for (const platform of ["zoom", "meet", "telemost", "unknown"]) {
      const command = botBuildCommand(platform)
      if (command === null) {
        continue
      }
      const script = command.replace(/^npm run /, "")
      expect(pkg.scripts[script], `${platform}: ${command}`).toBeDefined()
    }
  })

  it("текст про несобранный образ называет точную команду сборки", () => {
    expect(botImageMissingText("pm-assistant-zoom-bot", {})).toContain("npm run bot:build:zoom")
    expect(botImageMissingText("мой-образ", { ZOOM_BOT_IMAGE: "мой-образ" })).toContain(
      "npm run bot:build:zoom",
    )
  })
})
