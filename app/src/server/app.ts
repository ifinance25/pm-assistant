import { Hono } from "hono";
import { audioShareRouter } from "./routes/audio-share.ts";
import { botRouter } from "./routes/bot.ts";
import { healthRouter } from "./routes/health.ts";
import { logsRouter } from "./routes/logs.ts";
import { transcriptionQueueRouter } from "./routes/transcription-queue.ts";
import { meetingDetailRouter } from "./routes/meeting-detail.ts";
import { meetingsRouter } from "./routes/meetings.ts";
import { publicApiRouter } from "./routes/public-api.ts";
import { searchRouter } from "./routes/search.ts";
import { settingsRouter } from "./routes/settings.ts";
import { authRouter } from "./routes/auth.ts";
import { projectsRouter } from "./routes/projects.ts";
import { integrationsRouter } from "./routes/integrations.ts";
import { calendarRouter } from "./routes/calendar.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import type { AppEnv } from "./app-env.ts";

export const app = new Hono<AppEnv>();

app.use("*", sessionMiddleware);

app.route("/api/auth", authRouter);
app.route("/api/projects", projectsRouter);
app.route("/api/integrations", integrationsRouter);
app.route("/api/calendar", calendarRouter);
app.route("/api", healthRouter);
app.route("/api", settingsRouter);
app.route("/api", botRouter);
app.route("/api", logsRouter);
app.route("/api", transcriptionQueueRouter);
app.route("/api/meetings", meetingsRouter);
app.route("/api/meetings", meetingDetailRouter);
app.route("/api/search", searchRouter);
app.route("/api/public", publicApiRouter);
app.route("/api/audio-share", audioShareRouter);
