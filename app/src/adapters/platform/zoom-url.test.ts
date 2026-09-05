import { describe, expect, it } from "vitest"
import { parseZoomMeetingUrl } from "./zoom-url.ts"

describe("parseZoomMeetingUrl", () => {
  it("достаёт номер и пароль из /j/ ссылки регионального кластера", () => {
    const parsed = parseZoomMeetingUrl(
      "https://us05web.zoom.us/j/12345678901?pwd=abc.1",
    )
    expect(parsed.meetingNumber).toBe("12345678901")
    expect(parsed.password).toBe("abc.1")
    expect(parsed.host).toBe("us05web.zoom.us")
  })

  it("понимает web-client путь /wc/{n}/join", () => {
    const parsed = parseZoomMeetingUrl(
      "https://app.zoom.us/wc/98765432109/join?pwd=secret",
    )
    expect(parsed.meetingNumber).toBe("98765432109")
    expect(parsed.password).toBe("secret")
  })

  it("понимает /wc/join/{n}", () => {
    expect(
      parseZoomMeetingUrl("https://zoom.us/wc/join/11122233344").meetingNumber,
    ).toBe("11122233344")
  })

  it("бросает на чужом хосте", () => {
    expect(() => parseZoomMeetingUrl("https://meet.google.com/abc")).toThrow(
      /не похожа на Zoom/,
    )
  })
})
