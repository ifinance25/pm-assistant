import { describe, expect, it } from "vitest"
import { probe, probeText } from "./bot-probe.ts"

/** Проверка входа бота по ссылке: Docker в тестах не запускается. */
describe("bot:probe", () => {
  it("нераспознанную ссылку отклоняет и бота не поднимает", async () => {
    let started = false
    const outcome = await probe("https://example.com/meeting", {
      dockerReady: async () => true,
      join: async () => {
        started = true
        return { mode: "live", audioPath: null }
      },
    })
    expect(started).toBe(false)
    expect(outcome).toEqual({
      kind: "refused",
      reason: "ссылка не распознана: https://example.com/meeting",
    })
    expect(probeText(outcome)).toBe(
      "отказ: ссылка не распознана: https://example.com/meeting",
    )
  })

  it("без Docker печатает, какой образ собрать", async () => {
    const inspected: string[] = []
    const outcome = await probe("https://zoom.us/j/123456789", {
      dockerReady: async () => false,
      imageExists: async (image) => {
        inspected.push(image)
        return false
      },
      join: async () => ({ mode: "live", audioPath: null }),
    })
    expect(probeText(outcome)).toContain("npm run bot:build:zoom")
    expect(probeText(outcome)).toMatch(/^отказ: /)
    // Образ без живого Docker не проверить: утверждать, что его нет, нельзя.
    expect(probeText(outcome)).not.toMatch(/не собран/)
    expect(inspected).toEqual([])
  })

  it("Docker жив, образа нет: печатает точную команду сборки и бота не поднимает", async () => {
    let started = false
    const outcome = await probe("https://zoom.us/j/123456789", {
      dockerReady: async () => true,
      imageExists: async () => false,
      join: async () => {
        started = true
        return { mode: "live", audioPath: null }
      },
    })
    expect(started).toBe(false)
    expect(probeText(outcome)).toMatch(/^отказ: .*не собран.*npm run bot:build:zoom/)
  })

  it("вход печатает «вошёл»", async () => {
    const outcome = await probe("https://zoom.us/j/123456789", {
      dockerReady: async () => true,
      imageExists: async () => true,
      join: async (_meeting, hooks) => {
        await hooks?.onJoined?.({ mode: "live" })
        return { mode: "live", audioPath: null }
      },
    })
    expect(outcome.kind).toBe("joined")
    expect(probeText(outcome)).toBe("вошёл")
  })

  it("комната ожидания печатает «ждёт допуска» и не ждёт конца встречи", async () => {
    const gate = { release: () => {} }
    const outcome = await probe("https://meet.google.com/abc-defg-hij", {
      dockerReady: async () => true,
      join: async (_meeting, hooks) => {
        await hooks?.onWaitingRoom?.()
        // Встреча продолжается: проба обязана ответить, не дожидаясь её конца.
        await new Promise<void>((resolve) => {
          gate.release = resolve
        })
        return { mode: "live", audioPath: null }
      },
    })
    expect(probeText(outcome)).toBe("ждёт допуска")
    gate.release()
  })

  it("ошибку бота печатает причиной отказа", async () => {
    const outcome = await probe("https://telemost.yandex.ru/j/12345678901234", {
      dockerReady: async () => true,
      imageExists: async () => true,
      join: async () => {
        throw new Error("Телемост требует вход в аккаунт Яндекса")
      },
    })
    expect(probeText(outcome)).toBe("отказ: Телемост требует вход в аккаунт Яндекса")
  })

  it("«вошёл» только по хуку входа: завершившийся без него join не вход", async () => {
    const outcome = await probe("https://zoom.us/j/123456789", {
      dockerReady: async () => true,
      imageExists: async () => true,
      join: async () => ({ mode: "live", audioPath: null }),
    })
    expect(outcome.kind).toBe("refused")
    expect(probeText(outcome)).not.toBe("вошёл")
  })

  it("заглушку не печатает как «вошёл»", async () => {
    const outcome = await probe("https://zoom.us/j/123456789", {
      dockerReady: async () => true,
      imageExists: async () => true,
      join: async (_meeting, hooks) => {
        await hooks?.onJoined?.({ mode: "stub" })
        return { mode: "stub", audioPath: null }
      },
    })
    expect(outcome.kind).toBe("refused")
    expect(probeText(outcome)).toMatch(/^отказ: .*заглушк/)
  })
})
