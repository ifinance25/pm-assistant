export { detectPlatform } from "./detect.ts";
export {
  botImageName,
  botBuildCommand,
  type BotImageSpec,
} from "./bot-images.ts";
export {
  killOrphanBots,
  killOwnBots,
  meetingAudioFile,
  parseBotAudioLine,
  runBrowserBot,
  type BotHooks,
  type BotResult,
  type BotStatus,
} from "./bot-runtime.ts";
export {
  createJoinAdapter,
  JOIN_ADAPTERS,
  MeetAdapter,
  TelemostAdapter,
  UnknownAdapter,
  ZoomAdapter,
  MEET_NOT_IMPLEMENTED,
  PLATFORM_UNKNOWN,
  TELEMOST_NOT_IMPLEMENTED,
  ZOOM_NOT_CONFIGURED,
  type JoinAdapter,
  type JoinHooks,
  type JoinResult,
} from "./join.ts";
