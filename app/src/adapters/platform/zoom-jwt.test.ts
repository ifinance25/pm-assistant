import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { createMeetingSdkJwt, decodeJwtPayload } from "./zoom-jwt.ts"

describe("createMeetingSdkJwt", () => {
  it("подписывает HS256 с appKey, mn, role=0 и exp=iat+2ч", () => {
    const nowSec = 1_700_000_000
    const token = createMeetingSdkJwt({
      clientId: "sdk-client",
      clientSecret: "sdk-secret",
      meetingNumber: "12345678901",
      nowSec,
    })
    const payload = decodeJwtPayload(token)
    expect(payload.appKey).toBe("sdk-client")
    expect(payload.sdkKey).toBe("sdk-client")
    expect(payload.mn).toBe("12345678901")
    expect(payload.role).toBe(0)
    expect(payload.iat).toBe(nowSec)
    expect(payload.exp).toBe(nowSec + 7200)
    expect(payload.tokenExp).toBe(nowSec + 7200)
    const [header, body, sig] = token.split(".")
    const expected = createHmac("sha256", "sdk-secret")
      .update(`${header}.${body}`)
      .digest("base64url")
    expect(sig).toBe(expected)
  })
})
