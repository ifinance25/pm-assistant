import { createHmac } from "node:crypto"

export type MeetingSdkJwtInput = {
  clientId: string
  clientSecret: string
  meetingNumber: string
  role?: 0 | 1
  nowSec?: number
  ttlSec?: number
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

export function createMeetingSdkJwt(input: MeetingSdkJwtInput): string {
  const clientId = input.clientId.trim()
  const clientSecret = input.clientSecret.trim()
  const meetingNumber = input.meetingNumber.replace(/\s+/g, "")
  if (!clientId || !clientSecret) {
    throw new Error("нужны ZOOM_CLIENT_ID и ZOOM_CLIENT_SECRET")
  }
  if (!/^\d{9,13}$/.test(meetingNumber)) {
    throw new Error("некорректный номер встречи Zoom")
  }
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000)
  const ttlSec = input.ttlSec ?? 7200
  if (ttlSec < 1800 || ttlSec > 172800) {
    throw new Error("срок JWT Zoom должен быть от 30 минут до 48 часов")
  }
  const iat = nowSec
  const exp = iat + ttlSec
  const header = { alg: "HS256", typ: "JWT" }
  const payload = {
    appKey: clientId,
    sdkKey: clientId,
    mn: meetingNumber,
    role: input.role ?? 0,
    iat,
    exp,
    tokenExp: exp,
    video_webrtc_mode: 0,
  }
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`
  const signature = createHmac("sha256", clientSecret)
    .update(unsigned)
    .digest("base64url")
  return `${unsigned}.${signature}`
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".")
  if (parts.length !== 3) {
    throw new Error("некорректный JWT")
  }
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
    string,
    unknown
  >
}
