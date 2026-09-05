# Changelog

Формат по [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/). Версии по [SemVer](https://semver.org/lang/ru/).

<!-- unreleased:start -->

<!-- unreleased:end -->

## [0.2.1] - 2026-09-05

_Выкладки: 2026-09-05 13:00 (`4e3054f`) → EC2 `16.171.52.89`; 2026-09-05 13:07 (`4e3054f`) → EC2 `16.171.52.89`; 2026-09-05 15:26 (`4e3054f`) → EC2 `16.171.52.89`_

### Добавлено

- Allowlist Google OAuth, проверка `email_verified` и cookie `state` (CSRF)
- Смена пароля через `POST /api/auth/password`
- `tsc --noEmit` в `npm test`, `npm run lint` (Biome)
- Баннер «демо-данные» для встреч `source=stub`

### Исправлено

- Meet и Телемост: 503 «не реализовано», без demo fixture в БД
- Трекеры: stub не пишет `connected: true` / `tracker_state=created` без API id
- Владелец встречи (`owner_user_id`); настройки PUT только для admin
- Миграция `tracker_type`: однократно (`PRAGMA user_version`), не затирает ClickUp
- Валидация settings и блок private webhook (SSRF)
- FTS: экранирование запроса, ошибка MATCH не глотается
- Таймауты LLM / OAuth / Asana / webhook / Whisper
- Email UNIQUE COLLATE NOCASE; rate limit логина; Secure cookie при HTTPS
- Asana: при падении API помечаются только успешные задачи
- После удаления default-проекта встреча снова создаёт проект
- `hasActiveJob` SQL вместо квадратичного обхода jobs
- Перезапуск бота: только admin и `{confirm:true}`
- `REVIEW_SKIPPED_NOTICE` в рисках резюме, не в `meeting.error`
- Настройки: «Сохранить» в строке проекта и разбор пустого JSON
- Существующая учётка после колонки `role` получает admin (иначе PUT настроек 403)

### Состав выкладки

- `app`: 1 файл
- `app/.playwright-cli/console-2026-09-05T07-55-22-498Z.log`: 1 файл
- `app/.playwright-cli/page-2026-09-05T07-55-22-926Z.yml`: 1 файл
- `app/src/adapters/asana`: 2 файла
- `app/src/adapters/platform`: 1 файл
- `app/src/adapters/webhook`: 1 файл
- `app/src/mcp/protocol.test.ts`: 1 файл
- `app/src/server/app-env.ts`: 1 файл
- `app/src/server/audit-fixes.test.ts`: 1 файл
- `app/src/server/auth`: 2 файла
- `app/src/server/routes`: 1 файл
- `app/src/shared/fts-query.ts`: 1 файл
- `app/src/shared/http-timeout.ts`: 1 файл
- `app/src/shared/webhook-url.ts`: 1 файл
- `app/src/web/pages`: 1 файл
- `app/src/web/read-response-json.test.ts`: 1 файл
- `app/src/web/read-response-json.ts`: 1 файл
- `app/src/adapters/stt`: 6 файлов
- `app/src/shared/fts-query.test.ts`: 1 файл


## [0.2.0] - 

_Выкладки: 2026-09-05 11:43 (`4e3054f`) → EC2 `16.171.52.89`_

### Состав выкладки

- `app/src/adapters/tracker`: 2 файла
- `app/src/server/integrations.test.ts`: 1 файл
- `app/src/server/routes`: 3 файла


## [0.2.0] - 2026-09-05

### Добавлено

- v2 wave 1: auth (login + Google OAuth), миграция БД (projects, users, sessions), tracker_state
- Sidebar v2 (256/64), route guard, Projects API
- SemVer в package.json, версия в Настройках

### Изменено

- API требует сессию (кроме health, auth, public API)
