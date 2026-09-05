export type ZoomMeetingRef = {
  meetingNumber: string
  password: string
  host: string
}

export function parseZoomMeetingUrl(url: string): ZoomMeetingRef {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new Error("не удалось разобрать ссылку Zoom")
  }
  const host = parsed.hostname.toLowerCase()
  if (host !== "zoom.us" && !host.endsWith(".zoom.us")) {
    throw new Error("ссылка не похожа на Zoom")
  }
  const password = parsed.searchParams.get("pwd") ?? ""
  const path = parsed.pathname
  const match = path.match(/\/(?:j|s|wc\/join|join)\/(\d{9,13})/)
  if (match?.[1]) {
    return { meetingNumber: match[1], password, host }
  }
  const wc = path.match(/\/wc\/(\d{9,13})\/join/)
  if (wc?.[1]) {
    return { meetingNumber: wc[1], password, host }
  }
  throw new Error("не удалось найти номер встречи Zoom в ссылке")
}
