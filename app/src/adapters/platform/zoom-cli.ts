import { joinZoomMeeting, hasZoomSdkCredentials, zoomBotName } from "./zoom-bot.ts"
import { randomUUID } from "node:crypto"

const url = process.env.ZOOM_MEETING_URL?.trim() || process.argv[2]?.trim() || ""
if (!url) {
  console.error("нужен ZOOM_MEETING_URL или URL первым аргументом")
  process.exit(1)
}
if (!hasZoomSdkCredentials()) {
  console.error("нет ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET в окружении")
  process.exit(1)
}

console.log(`вход бота «${zoomBotName()}» в Zoom, запись звука до конца встречи…`)
try {
  const result = await joinZoomMeeting({ url, id: randomUUID() })
  console.log(
    `режим: ${result.mode}; звук: ${result.audioPath ?? "не записан"}`,
  )
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
