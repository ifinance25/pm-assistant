# PM Assistant — Project Schema

## Project Context

> **При старте каждой сессии:** прочитай `PM_Assistant.md` полностью.
> Это Project Pulse: главный источник текущего состояния, фокуса, решений, вопросов и next actions.

**Project:** PM Assistant
**Stack / Domain:** расшифровка звонков (Zoom / Google Meet / Яндекс.Телемост), распознавание речи, извлечение задач

---

## Directory Map

```
PM_Assistant.md          ← Project Pulse: goal, brief, decisions, questions, next actions
CLAUDE.md                ← операционная схема проекта
CHANGELOG.md             ← история релизов по semver; пишет record-release при sync.sh
log.md                   ← короткий append-only changelog сессий vault
sessions/                ← только важные session narratives
artifacts/               ← планы, схемы, документы, результаты
raw/                     ← неизменяемые источники
wiki/                    ← knowledge base, развивается только при необходимости
```

---

## Operating Principle

**Pulse first, Wiki when needed, Shared only by review.**

Project Pulse — источник правды. Wiki, sessions и Dashboard — производные или дополнительные слои.

Одна операция должна менять минимальный набор файлов.

**Код приложения (`app/`) не начинать, пока спецификация в `artifacts/` не утверждена пользователем явно.**

---

## Save Workflow

| Событие | Обновить |
|---|---|
| Малое изменение | `PM_Assistant.md` + `log.md` |
| Новое решение | `Decisions Log` в `PM_Assistant.md` + `log.md` |
| Обычная рабочая сессия | `Current Focus`, `Next Actions`, `Open Questions` + `log.md` |
| Стратегическая/decision-heavy сессия | всё выше + `sessions/YYYY-MM-DD.md` |
| Новый artifact | `artifacts/` + секция `Artifacts` + `log.md` |
| Ingest источника | `raw/` читать, затем `wiki/sources/<slug>.md` или обновить Pulse + `log.md` |
| Существенное изменение понимания | `wiki/overview.md` + Pulse + `log.md` |

Не обновлять `wiki/index.md`, `overview.md`, `sessions/` и Dashboard автоматически при каждом действии.

---

## Query Workflow

Когда задан вопрос:

1. Прочитать Project Pulse.
2. Если нужна wiki — прочитать `wiki/index.md` или релевантные страницы.
3. Ответить с ссылками только на реально полезные страницы.
4. Предложить сохранить ответ только если это reusable artifact, decision rationale или важный анализ.

---

## Ingest Workflow

Когда сказано инжестировать источник из `raw/`:

1. Прочитать Project Pulse.
2. Прочитать источник.
3. Создать `wiki/sources/<slug>.md` только если источник стоит хранить отдельно.
4. Обновить `wiki/overview.md` только если источник меняет понимание проекта.
5. Создать `wiki/concepts` или `wiki/entities` только если знание reusable, спорное, архитектурно важное или часто цитируемое.
6. Обновить Project Pulse: decisions, open questions, next actions, artifacts.
7. Добавить короткую запись в `log.md`.

По умолчанию один источник не должен порождать 5-15 страниц.

---

## Sessions

Сохранять `sessions/YYYY-MM-DD.md` только для важных сессий:
- стратегический разбор;
- 3+ значимых решения;
- важные альтернативы и причины выбора;
- handoff перед паузой или передачей проекта.

Session-файл должен начинаться с краткого executive summary.

---

## Wikilinks

Добавлять только смысловые wikilinks:
- зависимость между проектами;
- общий artifact;
- повторное использование решения;
- источник или концепция, без которой трудно понять решение.

Не добавлять ссылки ради устранения orphan-узлов. Obsidian Graph — побочный продукт, не KPI.

---

## Shared Wiki

`_shared/wiki` не участвует в обычном workflow проекта.

Не проверять `_shared/wiki/index.md` перед каждой entity/concept.
Не переносить страницы в shared автоматически.

Shared-страницы создаются только по явной команде или во время отдельного review, если знание стабильно используется в 3+ активных проектах.

---

## Weekly Review

Когда сказано сделать weekly review:

1. Прочитать `PM_Assistant.md`.
2. Проверить status, priority, current focus, blockers, open questions, next actions.
3. Обновить `last_touched`, `next_review`, `review_cadence` при необходимости.
4. Предложить: продолжить, поставить на паузу, закрыть или архивировать.
5. Добавить краткую запись в `log.md`.
6. Создать session summary только если review содержит важные решения.

---

## Page Format Conventions

### Source page (`wiki/sources/<slug>.md`)
```markdown
---
type: source
date_ingested: YYYY-MM-DD
source_type: article | doc | transcript | pdf | note
language: en | ru | ...
original: raw/<filename>
---

# <Title>

## Summary
(2-4 sentences)

## Key Takeaways
- ...

## Relevant To
Optional wikilinks only if useful.

## Quotes / Excerpts
> ...
```

### Concept page (`wiki/concepts/<slug>.md`)
```markdown
---
type: concept
---

# <Concept Name>

## Definition

## Relevance to This Project

## Trade-offs / Nuances

## Related
Optional meaningful links.
```

### Entity page (`wiki/entities/<slug>.md`)
```markdown
---
type: entity
entity_type: tool | vendor | framework | person | product
---

# <Name>

## What It Is

## How It's Used in This Project

## Trade-offs / Nuances

## Related
Optional meaningful links.
```

---

## Language Convention

Wiki-страницу писать на языке основного источника или языка проекта. Wikilinks нейтральны к языку.

IT-термины — с русским аналогом в скобках при первом упоминании (пользователь не программист).

<!-- autopilot:start -->
# PM Assistant

Локальное веб-приложение для расшифровки рабочих звонков (Zoom, Google Meet, Яндекс.Телемост): протокол, задачи, очередь в Asana. Для личного использования, без экрана входа, слушает только `127.0.0.1`.

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
- `src/server/routes/meetings.ts`, `src/server/routes/meeting-detail.ts`, `src/server/routes/search.ts`, `src/server/routes/settings.ts`, `src/server/routes/health.ts`, `src/server/routes/public-api.ts`
- `src/worker/pipeline.ts`, `src/worker/status.ts`, `src/worker/index.ts`
- `src/adapters/platform/`, `src/adapters/stt/`, `src/adapters/llm/`, `src/adapters/asana/`, `src/adapters/webhook/`, `src/adapters/announce/`, `src/adapters/slides/`, `src/adapters/voiceprint/`
- `src/web/App.tsx`, `src/web/shell/Shell.tsx`, `src/web/pages/home/Home.tsx`, `src/web/pages/meeting/MeetingPage.tsx`, `src/web/pages/archive/ArchivePage.tsx`, `src/web/pages/calendar/CalendarPage.tsx`, `src/web/pages/settings/SettingsPage.tsx`
- `src/mcp/protocol.ts`, `src/mcp/index.ts`
- `fixtures/demo-meeting.json`, `.env.example`, `vite.config.ts`, `vitest.config.ts`, `package.json`

## Архитектура

Поток: ссылка → `POST /api/meetings` → `detectPlatform` → встреча `queued` + `enqueueJob(join)` → воркер `claimNextJob` → `joining` → `JoinAdapter.join` → объявление → `recording` → STT (распознавание речи) → `transcribing` → `summarizing` → LLM (языковая модель) → резюме и задачи → `ready` | `error` → вебхук `meeting.ready` → `maybeAutoSendAsana`.

Статусы: `queued` → `joining` → `recording` → `transcribing` → `summarizing` → `ready` | `error`. Переходы режет `assertStatusTransition`.

Границы: `db` владеет SQLite и схемой; `meetings-api` (HTTP) на `127.0.0.1`; адаптеры platform / stt / llm / asana / webhook / announce / slides / voiceprint не пишут SQL; `worker` отдельный процесс; `shell` маршруты UI; MCP читает ту же БД по stdio.

HTTP: `POST /api/meetings` `{url}` 201 или 200 `alreadyRunning`; `GET /api/meetings` + `storage`; `GET /api/meetings/:id` (`meeting`, `transcript`, `summary`, `actionItems`, `realtime`); `POST .../retry` (409 если не `error`); `POST .../asana-queue`; `GET /api/search?q=&platform=&period=&status=`; `GET/PUT /api/settings`; `GET /api/health` (`workerAlive` если heartbeat < 15 с); `GET /api/public/meetings` и `/:id` с `Authorization: Bearer APP_API_TOKEN`.

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

## Окружение

Имена (значения не хранить и не выдумывать):

- `.env.example`: `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `ASANA_PAT`, `TRELLO_API_KEY`, `CLICKUP_API_TOKEN`, `NOTION_API_KEY`, `APP_API_TOKEN`
- Один Google OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) для входа и календаря (ADR `.autopilot/spec.md` §8). Redirect: `PM_ASSISTANT_GOOGLE_REDIRECT_URI`.
- Трекер по умолчанию: ClickUp. Живые OAuth трекеров в v2: заглушки connect/disconnect.
- в коде ещё: `PORT` (по умолчанию 8787), `PM_ASSISTANT_DB_PATH` (по умолчанию `data/app.sqlite`), `WHISPER_BIN`

Скрипты `.env` сами не читают: пакета dotenv нет, в `package.json` нет `--env-file`.

## Тесты

Vitest. Полный прогон: `npm test` (`vitest run`). Один файл: `npx vitest run src/db/db.test.ts`.

23 файла рядом с кодом: `src/**/*.test.ts` и `src/**/*.test.tsx`.

## Подводные камни

- Команды только из `app/`. Из корня vault `npm` ищет чужой `package.json`.
- `npm run dev` уже слушает :5173: второй экземпляр упадёт (`strictPort: true`).
- Без воркера встреча остаётся `queued`.
- `JoinAdapter` сейчас всегда `stub`; воркер из-за этого форсит заглушки STT/LLM (`detectEngine: () => null`, `apiKey: ""`), даже если задан `OPENAI_API_KEY`.
- Живой гостевой вход в Телемост в этой версии недоступен.
- `POST .../retry` ставит `queued`, но не вызывает `enqueueJob`: воркер новое задание не увидит.
- Задание после `claimNextJob` остаётся `running`, статуса completed нет.
- Пустой `APP_API_TOKEN`: весь `/api/public` отвечает 401.
- `ZOOM_*` / `GOOGLE_*` есть в `.env.example`, `join.ts` их не читает.
- `better-sqlite3` нативный: при `ignore-scripts=true` нужна пересборка (см. README).
- Путь БД относительный от `cwd`; Vite проксирует `/api` на 8787.

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски лежат в `.autopilot/`.
Прогресс: `.autopilot/dashboard.html`. Требование из `manifest.md` снимает только пользователь.
Если работа продолжается, скажи «продолжи автопилот»: состояние поднимется из `.autopilot/state.js`, переспрашивать ничего не нужно.
<!-- autopilot:end -->
