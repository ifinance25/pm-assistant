/**
 * `npm run bot:probe -- <ссылка>`: платформа определяется по ссылке, бот входит
 * в звонок, печатается «вошёл», «ждёт допуска» или «отказ: <причина>».
 * Встреча в базе не создаётся. После ответа снимается только контейнер, который
 * подняла сама проба (метка владельца); бот живой встречи у воркера не трогается.
 */
import { killOwnBots } from "./bot-runtime.ts"
import { probe, probeText } from "./bot-probe.ts"

const url = process.argv[2]?.trim() ?? ""
if (!url) {
  console.error("нужна ссылка на встречу первым аргументом")
  process.exit(1)
}

// Проба всегда в контейнере: иначе бот остаётся жить локальным процессом.
process.env.ZOOM_BOT_RUNTIME = "docker"

const outcome = await probe(url)
console.log(probeText(outcome))
const cleanup = await killOwnBots()
if (cleanup.killed.length > 0) {
  console.log(`контейнеры сняты: ${cleanup.killed.join(", ")}`)
}
process.exit(outcome.kind === "refused" ? 1 : 0)
