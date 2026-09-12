# PM Assistant — Project Schema

**Project:** PM Assistant
**Stack / Domain:** расшифровка звонков (Zoom / Google Meet / Яндекс.Телемост), распознавание речи, извлечение задач

## Старт сессии

`PM_Assistant.md` (Project Pulse) читать послойно, не целиком: файл 30 КБ.

- **Всегда:** frontmatter, `AI Brief`, `Current Focus`, `Next Actions`.
- **По запросу или при weekly review:** `Decisions Log`, `Open Questions`, `Artifacts`.

Общие правила vault (save workflow, query, ingest, sessions, wikilinks, shared wiki, weekly review) живут в корневом `CLAUDE.md`. Здесь не дублируются.

Шаблоны страниц wiki и языковые соглашения — в `wiki/_conventions.md`, читать только при работе с `wiki/`.

## Directory Map

```
PM_Assistant.md          ← Project Pulse: goal, brief, decisions, questions, next actions
CLAUDE.md                ← этот файл: код и операционная схема
CHANGELOG.md             ← история релизов по semver
log.md                   ← короткий append-only changelog сессий
sessions/                ← только важные session narratives
artifacts/               ← планы, схемы, документы, результаты
raw/                     ← неизменяемые источники
wiki/                    ← knowledge base, развивается только при необходимости
app/                     ← код приложения
```

## Правило проекта

Код приложения (`app/`) не начинать, пока спецификация в `artifacts/` не утверждена пользователем явно.

<!-- autopilot:start -->
# PM Assistant

Локальное веб-приложение для расшифровки рабочих звонков (Zoom, Google Meet, Яндекс.Телемост): протокол, задачи, очередь в Asana. Для личного использования, слушает только `127.0.0.1`.

## Команды

Корень кода: `Projects/PM Assistant/app/` (не корень vault). `node_modules` уже есть, `npm install` не гоняли.

```bash
cd "Projects/PM Assistant/app"
npm run dev
```

Vite (сборщик) на http://127.0.0.1:5173, API (Hono) на `127.0.0.1:8787`, `/api` проксируется. Процесс уже жив: не поднимать второй.

```bash
npm run worker
```

Отдельный процесс Node: задания из SQLite, heartbeat (пульс) в настройки.

```bash
npm run mcp
```

stdio JSON-RPC 2.0, инструменты `list_meetings` и `get_meeting`.

```bash
npm test
npx vitest run src/db/db.test.ts
npm run build
```

## Структура

```
app/
  src/db/            SQLite, схема, FTS5 (полнотекст)
  src/server/        Hono API, маршруты, dev.ts
  src/web/           React UI, оболочка, экраны
  src/worker/        конвейер статусов и jobs (задания)
  src/adapters/      платформы, STT, LLM, Asana, вебхук, слайды, голос
  src/mcp/           stdio JSON-RPC
  src/shared/        общие типы
  fixtures/          demo-meeting.json
  data/              app.sqlite (создаётся сама)
```

## Ключевые файлы

- `src/shared/types.ts`: платформы, статусы, встреча, транскрипт, резюме, задачи, настройки
- `src/db/index.ts`, `src/db/schema.ts`: `createDb` / `getDb` / `setDb`, SQL скрыт
- `src/server/app.ts`, `src/server/dev.ts`, `src/server/index.ts`: сборка роутеров, Vite+API
- Маршруты `src/server/routes/`: `auth.ts`, `projects.ts`, `integrations.ts`, `calendar.ts`, `health.ts`, `settings.ts`, `bot.ts`, `logs.ts`, `transcription-queue.ts`, `meetings.ts`, `meeting-detail.ts`, `search.ts`, `public-api.ts`
- `src/worker/pipeline.ts`, `src/worker/status.ts`, `src/worker/index.ts`
- `src/adapters/platform/` (в том числе живой `zoom-bot.ts`), `src/adapters/stt/`, `src/adapters/llm/`, `src/adapters/asana/`, `src/adapters/webhook/`, `src/adapters/announce/`, `src/adapters/slides/`, `src/adapters/voiceprint/`
- `src/web/App.tsx`, `src/web/shell/Shell.tsx`, `src/web/pages/home/Home.tsx`, `src/web/pages/meeting/MeetingPage.tsx`, `src/web/pages/archive/ArchivePage.tsx`, `src/web/pages/calendar/CalendarPage.tsx`, `src/web/pages/settings/SettingsPage.tsx`
- `src/web/shell/Sidebar.tsx` (`Sidebar` + `TabBar`), `src/web/styles/tokens.css`, `src/web/styles/shell.css`: мобильный каркас
- `src/mcp/protocol.ts`, `src/mcp/index.ts`
- `fixtures/demo-meeting.json`, `.env.example`, `vite.config.ts`, `vitest.config.ts`, `package.json`

## Архитектура

Поток: ссылка → `POST /api/meetings` → `detectPlatform` → встреча `queued` + `enqueueJob(join)` → воркер `claimNextJob` → `joining` → `JoinAdapter.join` → объявление → `recording` → STT (распознавание речи) → `transcribing` → `summarizing` → LLM (языковая модель) → резюме и задачи → `ready` | `error` → вебхук `meeting.ready` → `maybeAutoSendAsana`.

Статусы: `queued` → `joining` → `recording` → `transcribing` → `summarizing` → `ready` | `error`. Переходы режет `assertStatusTransition`.

Задания (`jobs`): `pending` → `claimNextJob` ставит `running` → `finishJob` ставит `done`, `failJob` ставит `failed`.

Границы: `db` владеет SQLite и схемой; HTTP API на `127.0.0.1`; адаптеры platform / stt / llm / asana / webhook / announce / slides / voiceprint не пишут SQL; `worker` отдельный процесс; `shell` маршруты UI; MCP читает ту же БД по stdio.

HTTP: `POST /api/meetings` `{url}` 201 или 200 `alreadyRunning`; `GET /api/meetings` + `storage`; `GET /api/meetings/:id` (`meeting`, `transcript`, `summary`, `actionItems`, `realtime`); `POST .../retry` (409 если не `error`); `POST .../asana-queue`; `GET /api/search?q=&platform=&period=&status=`; `GET/PUT /api/settings`; `GET /api/health` (`workerAlive` если heartbeat < 15 с); `GET /api/public/meetings` и `/:id` с `Authorization: Bearer APP_API_TOKEN`. Плюс `/api/auth`, `/api/projects`, `/api/integrations`, `/api/calendar`, `/api/bot`, `/api/logs`, очередь расшифровки.

UI: `/` Главная, `/calendar`, `/archive`, `/settings`, `/meetings/:id`; `/integrations` заглушка. `CalendarPlaceholder` / `ArchivePlaceholder` / `SettingsPlaceholder` реэкспортируют живые страницы.

## Соглашения кода

- ESM, Node 24 запускает `.ts` напрямую; импорты с суффиксом `.ts` / `.tsx`.
- Фабрики: `createDb`, `createJoinAdapter`, `createSttAdapter`, `createLlmAdapter`, `createAsanaAdapter`, `createSlidesAdapter`, `createVoiceprintAdapter`.
- Синглтон БД: `getDb()` / `setDb()` для API, воркера, MCP и тестов.
- Адаптер отдаёт `mode: "live" | "stub"` по ключу или бинарнику.
- Тексты UI по-русски; символ U+2014 не использовать.
- Слушать только `127.0.0.1`; секреты не коммитить (`.env` в `.gitignore`).
- HTTP-тесты: `createDb(":memory:")`, `setDb(db)`, `app.request`.
- React-тесты: `renderToString`, среда Vitest `node` (не jsdom).
- Мобильный порог: комментарий вверху `tokens.css` фиксирует 640/1024 как общий breakpoint проекта (телефон ≤640, планшет 641-1024, десктоп >1024); этими же числами пользуются `@media` во всех `*.css` экранов.
- Сайдбар↔таббар на ≤640px переключается чисто CSS (`shell.css`, `@media(max-width:640px)`: `.sidebar{display:none}`, `.tabbar{display:flex}`), без JS/matchMedia/state; `TabBar()` — экспорт `Sidebar.tsx`, `Shell.tsx` рендерит его всегда в DOM рядом с `<Sidebar>`.
- Таблица проектов в Настройках на ≤640px — карточки только через `display:grid` на `.settings__table tr` (`settings.css`), разметка `<table>` не менялась.

## Окружение

Имена (значения не хранить и не выдумывать):

- `.env.example`: `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `ASANA_PAT`, `TRELLO_API_KEY`, `CLICKUP_API_TOKEN`, `NOTION_API_KEY`, `APP_API_TOKEN`
- Один Google OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) для входа и календаря (ADR `.autopilot/spec.md` §8). Redirect входа: `PM_ASSISTANT_GOOGLE_REDIRECT_URI`. Redirect календаря (второй, тот же client): `PM_ASSISTANT_GOOGLE_CALENDAR_REDIRECT_URI`.
- Трекер по умолчанию: ClickUp. Живые OAuth трекеров в v2: заглушки connect/disconnect.
- в коде ещё: `PORT` (по умолчанию 8787), `PM_ASSISTANT_DB_PATH` (по умолчанию `data/app.sqlite`), `WHISPER_BIN`, `ZOOM_BOT_HEADLESS`, `ZOOM_BOT_IMAGE`, `ZOOM_BOT_RUNTIME`

Скрипты `.env` сами не читают: пакета dotenv нет, в `package.json` нет `--env-file`.

## Тесты

Vitest. Полный прогон: `npm test` (`vitest run`). Один файл: `npx vitest run src/db/db.test.ts`.

56 файлов рядом с кодом: `src/**/*.test.ts` и `src/**/*.test.tsx`.

## Подводные камни

- Команды только из `app/`. Из корня vault `npm` ищет чужой `package.json`.
- `npm run dev` уже слушает :5173: второй экземпляр упадёт (`strictPort: true`).
- Без воркера встреча остаётся `queued`.
- Zoom ходит живым ботом (`zoom-bot.ts`, читает `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET`). Meet и Телемост пока заглушки.
- Живой гостевой вход в Телемост в этой версии недоступен.
- Пустой `APP_API_TOKEN`: весь `/api/public` отвечает 401.
- `better-sqlite3` нативный: при `ignore-scripts=true` нужна пересборка (см. README).
- Путь БД относительный от `cwd`; Vite проксирует `/api` на 8787.

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски лежат в `.autopilot/`.
Прогресс: `.autopilot/dashboard.html`. Требование из `manifest.md` снимает только пользователь.
Если работа продолжается, скажи «продолжи автопилот»: состояние поднимется из `.autopilot/state.js`, переспрашивать ничего не нужно.
<!-- autopilot:end -->
