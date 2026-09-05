# PM Assistant

Локальное веб-приложение для расшифровок встреч. Слушает только `127.0.0.1`, экрана входа нет.

## Установка

```bash
cd "Projects/PM Assistant/app"
npm install
```

Если `better-sqlite3` не собрался (часто при `ignore-scripts=true`), из каталога пакета:

```bash
node "$(npm prefix -g)/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js" rebuild --release
```

запускать из `node_modules/better-sqlite3`.

Скопируйте `.env.example` в `.env` и при необходимости заполните имена ключей. Пустые значения допустимы: соответствующие адаптеры работают как заглушки.

## Запуск веба

```bash
npm run dev
```

Открыть http://127.0.0.1:5173. Vite раздаёт UI, `/api` проксируется в Hono на той же машине.

## Воркер

```bash
npm run worker
```

Отдельный процесс Node. Забирает задания из SQLite, гоняет встречу `queued` → `ready` (или `error`) и пишет heartbeat (`workerHeartbeatAt`) в таблицу `settings`. `GET /api/health` показывает, жив ли процесс. Веб и воркер делят одну SQLite (`data/app.sqlite`). Если воркер выключен, встреча остаётся `queued`, веб продолжает работать.

## Яндекс.Телемост

Живой гостевой вход в звонок Телемоста в этой версии недоступен: нет стабильного способа войти как обычный участник и писать звук без отдельного браузерного контура. Адаптер принимает ссылку, join идёт в режиме `stub`, дальше тот же конвейер по фикстуре. Когда появится надёжный гостевой вход, его подставят за тем же `JoinAdapter`.

## MCP для агентов

Локальный сервер по stdio: JSON-RPC 2.0 без пакета SDK. Инструменты: `list_meetings`, `get_meeting` (транскрипт, резюме, задачи).

```bash
npm run mcp
```

В Cursor или Claude Desktop, файл конфигурации MCP:

```json
{
  "mcpServers": {
    "pm-assistant": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "<абсолютный путь>/Projects/PM Assistant/app"
    }
  }
}
```

## Тесты

```bash
npm test
```

Один файл:

```bash
npx vitest run src/db/db.test.ts
```

## Данные

SQLite создаётся сама при первом запуске. Таблицы: `meetings`, `transcript_segments`, `summaries`, `action_items`, `settings`, `jobs`, плюс FTS5 `meetings_fts`.
