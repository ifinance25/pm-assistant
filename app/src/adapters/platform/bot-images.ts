/**
 * Образы браузерных ботов: по одному на платформу. Новая платформа добавляет
 * одну строку в `BOT_IMAGES` и одну строку `bot:build:<платформа>` в package.json.
 */
import type { Platform } from "../../shared/types.ts"

export type BotPlatform = Exclude<Platform, "unknown">

export type BotImageSpec = {
  platform: BotPlatform
  /** Путь к Dockerfile от корня приложения. */
  dockerfile: string
  /** Имя образа по умолчанию. */
  image: string
  /** Переменная окружения, которой имя образа можно переопределить. */
  imageEnvName: string
}

/** Контекст сборки один для всех образов: в нём лежит общий bot/common. */
export const BOT_BUILD_CONTEXT = "bot"

/**
 * Единственный источник имени образа и переменной, которой его переопределяют.
 * `satisfies`, а не аннотация типа: платформенный модуль читает `BOT_IMAGES.zoom.image`
 * без проверки на `undefined`.
 */
export const BOT_IMAGES = {
  zoom: {
    platform: "zoom",
    dockerfile: "bot/zoom-web/Dockerfile",
    image: "pm-assistant-zoom-bot",
    imageEnvName: "ZOOM_BOT_IMAGE",
  },
  meet: { platform: "meet", dockerfile: "bot/meet-web/Dockerfile", image: "pm-assistant-meet-bot", imageEnvName: "MEET_BOT_IMAGE" },
  telemost: {
    platform: "telemost",
    dockerfile: "bot/telemost-web/Dockerfile",
    image: "pm-assistant-telemost-bot",
    imageEnvName: "TELEMOST_BOT_IMAGE",
  },
} satisfies Partial<Record<BotPlatform, BotImageSpec>>

/** Образы одной платформы или все известные, если платформа не названа. */
export function botImageSpecs(platform?: string): BotImageSpec[] {
  const all: BotImageSpec[] = Object.values(BOT_IMAGES)
  if (!platform) {
    return all
  }
  return all.filter((spec) => spec.platform === platform)
}

export function botImageName(
  platform: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const spec = botImageSpecs(platform)[0]
  if (!spec) {
    return null
  }
  return env[spec.imageEnvName]?.trim() || spec.image
}

/**
 * Команда, которую человек должен выполнить, если образа нет. `null`, если у
 * платформы образа нет: подсказка не называет скрипт, которого нет в package.json
 * (соответствие строк `BOT_IMAGES` и скриптов `bot:build:*` держит тест).
 */
export function botBuildCommand(platform: string): string | null {
  if (!platform || botImageSpecs(platform).length === 0) {
    return null
  }
  return `npm run bot:build:${platform}`
}

/** Платформа, чей образ носит это имя (по умолчанию или из окружения). */
export function botPlatformForImage(
  image: string,
  env: NodeJS.ProcessEnv = process.env,
): BotPlatform | null {
  for (const spec of botImageSpecs()) {
    if (spec.image === image || botImageName(spec.platform, env) === image) {
      return spec.platform
    }
  }
  return null
}

/** Текст отказа, когда Docker жив, а образа нет. Звать только после проверки. */
export function botImageMissingText(
  image: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const platform = botPlatformForImage(image, env)
  const command = platform ? botBuildCommand(platform) : null
  return command
    ? `образ ${image} не собран. Выполните в каталоге app: ${command}`
    : `образ ${image} не собран`
}

export function dockerBuildArgs(
  spec: BotImageSpec,
  image: string,
  context = BOT_BUILD_CONTEXT,
): string[] {
  return ["build", "-f", spec.dockerfile, "-t", image, context]
}
