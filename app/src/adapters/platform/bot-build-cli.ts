/**
 * Сборка образов ботов: `npm run bot:build` — все, `npm run bot:build:zoom` —
 * только Zoom. Запускать из каталога app: контекст сборки — `bot`.
 */
import { spawnSync } from "node:child_process"
import { botImageName, botImageSpecs, dockerBuildArgs } from "./bot-images.ts"
import { whichDocker } from "./bot-runtime.ts"

const only = process.argv[2]?.trim() ?? ""
const specs = botImageSpecs(only || undefined)
if (specs.length === 0) {
  console.error(
    only
      ? `нет образа для платформы «${only}»`
      : "образов ботов пока нет: bot/<платформа>/Dockerfile не описан",
  )
  process.exit(1)
}

const bin = whichDocker()
if (!bin) {
  console.error("бинарник docker не найден: установите Docker и запустите его")
  process.exit(1)
}

for (const spec of specs) {
  const image = botImageName(spec.platform) ?? spec.image
  const args = dockerBuildArgs(spec, image)
  console.log(`сборка ${image}: docker ${args.join(" ")}`)
  const result = spawnSync(bin, args, { stdio: "inherit" })
  if (result.status !== 0) {
    console.error(`сборка ${image} не удалась`)
    process.exit(1)
  }
}
console.log(`готово: ${specs.length} образ(ов)`)
