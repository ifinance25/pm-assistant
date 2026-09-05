# Activity Log

Append-only. Короткий changelog, не session narrative.

Формат: `## [YYYY-MM-DD] <type> | <title>`

Types: `setup`, `session`, `decision`, `ingest`, `artifact`, `review`, `lint`.

Каждая запись должна кратко фиксировать:
- что изменилось;
- какие файлы/артефакты затронуты;
- следующий шаг, если он появился.

---

## [2026-09-05] session | STT: срез тишины по краям, без заглушки отпечатка

Перед Whisper срезаются только ведущая и хвостовая тишина (паузы в середине остаются), таймкоды сдвигаются на длительность начала. С экрана встречи убрана серая подпись «отпечаток не рассчитан». Файлы: `app/src/adapters/stt/trim-silence.ts`, `live.ts`, `MeetingView.tsx`. Локально 189 тестов. На проде код ещё не выкачен.

---

## [2026-09-05] session | Архив v2: экран Транскрибации по макету OuL9Y

`/archive` приведён к кадру `v2 Архив транскрибаций`: заголовок «Транскрибации», поиск в шапке без колокольчика, чипы проект/статус, список+деталь, выдача без обязательного запроса. Next: сверить в браузере `/archive`.

---

## [2026-09-05] session | Главная HomeView по кадру MY7XW

`HomeView` сверен с Pencil `v2 Главная`: шапка только «Главная» + поиск; helper про ссылку и проект; чипы Zoom / Google Meet / Яндекс Телемост; живая полоса (длительность · платформа · проект); проекты строками; «ссылки уже сохранены»; карточки расшифровок со сниппетом. `GET /api/meetings` отдаёт `headline`. Тесты HomeView 2/2. На EC2 не выкатывали.

---

## [2026-09-05] session | Сайдбар и шапка по макету v2 Главная

Сверка Pencil `gGl1a` / `MY7XW` с кодом 0.2.1: пункты nav уже верные, хром остался от v1 (`00-all-screens.pen`). Убраны TopBar «Поиск по встречам» + колокольчик. Сайдбар: house/file-text, audio-lines, collapse в строке бренда, без подписи «встречи и протоколы», заметка календаря в подвале, полоска хранилища, аватар peach. Тесты shell 5/5. На EC2 не выкатывали.

---

## [2026-09-05] session | Релиз 0.2.1: аудит + EC2

Закрыты P0/P1 аудита (allowlist Google, Meet/Телемост 503, stub трекеров, owner_user_id, миграция tracker_type, tsc+Biome). Версия `app/package.json` 0.2.1. `sync.sh` + build + restart api/worker. doctor OK. Smoke FT-01…08, batch проектов, Range 206. После первой выкладки учётка env была `role=user`: бэкфилл admin (`user_version=2`), повторный PUT settings 400 как ожидалось. Прогон: `artifacts/audit/2026-09-05-0.2.1-protocol-run.md`. Next: живой Zoom и ключи Google/трекеров.

---

## [2026-09-05] session | Баг: проект без Сохранить + пустой JSON

На Настройках в строке new/edit была только «Отмена» (глобальная «Сохранить» в шапке таблицы). `onSave` вызывал `response.json()` на пустом теле ошибки: Chromium `Unexpected end of JSON input`. Правка: «Сохранить» в строке + `readResponseJson`. Тесты 166/166. На прод не выкатывали.

---

## [2026-09-05] artifact | Макеты: архив v1, канон переименован

Старые макеты (`00-all-screens`, `01-home`, экраны v1, PNG, `exports-tmp`) перенесены в `artifacts/designs/archive/`. Живой канон: `artifacts/designs/design-mockup-version-2.pen` (бывший `02-home-transcript-v2.pen`) + PNG рядом. Исторические записи в этом журнале не переписывались.

---

## [2026-09-05] session | T-V2-DEPLOY: sync EC2 + prod QA

Сверка: handoff устарел (11/22, 150 тестов); state.js и код уже 22/22, 160/160. Локально подтверждено `npm test` 160/160, `npm run build` OK. `sync.sh` → EC2, `npm install` + build на сервере, restart `pm-assistant-api` / `pm-assistant-worker`, zoom-bot containers cleared. FT-01…08 + FT-10 PASS на 127.0.0.1. Обновлены `state.js`, `tasks.md`, `artifacts/2026-09-05-deploy-qa-report.md`, `PM_Assistant.md`. Кампания v2-ui закрыта.

---

## [2026-09-05] session | Autopilot T-V2-08…22 без паузы после волны

Продолжение с T-V2-08: таблица проектов и глобальная «Сохранить», интеграции-заглушки, POST meetings + projectId, Главная v2; дальше audio, расшифровка без табов, ask, архив/календарь, tracker stubs, docs. `npm test` 160/160. Deploy не делали. Следующий: T-V2-DEPLOY только по явной команде.

---

## [2026-09-05] artifact | Deploy QA v0.2.0 на EC2

Выкачка 0.2.0 на `16.171.52.89`: локально 128/128 тестов, prod QA 11/11 pass (auth, health, UI, projects после re-sync). Отчёт: `artifacts/2026-09-05-deploy-qa-report.md`. Следующий шаг: браузерный smoke по SSH-туннелю, живой звонок.

## [2026-09-03] setup | Проект создан

Создана структура проекта по методологии Pulse: `PM_Assistant.md`, `CLAUDE.md`, `log.md`, папки `sessions/`, `artifacts/`, `raw/`, `wiki/`. Зафиксированы три решения по продукту (гибрид захвата звука, русский язык в приоритете, обязательные платформы Zoom/Google Meet/Телемост) — см. Decisions Log в `PM_Assistant.md`. Related project: [[Project Management Tools]] (интеграция задач через Asana MCP).

Следующий шаг: исследование топ-5 платформ-конкурентов, результат → `artifacts/`.

## [2026-09-03] artifact | Конкурентный обзор платформ транскрибации

Агент `deep-research` собрал сравнение Otter/Fireflies/Fathom/Grain/tl;dv/MeetGeek + отдельный блок по русскому рынку и движкам распознавания. Файл: `artifacts/2026-09-03-competitor-analysis-transcription-platforms.md` (64 источника, каждый непроверенный факт помечен "требует проверки").

Ключевые находки, меняющие картину: (1) у Телемоста уже есть встроенная расшифровка «Конспект от Алисы Про», но только на платных корпоративных тарифах, без API, без реального времени, запись удаляется через 24 часа; (2) гипотеза «ни один из топ-5/6 не поддерживает Телемост» подтвердилась на 100%, но 3-4 российских сервиса (Speech2Text, mymeet.ai, Конспектор) уже подключаются к нему гостевым ботом по ссылке; (3) с 1 июля 2025 в РФ действует норма, ограничивающая хранение персональных данных россиян на зарубежных серверах — влияет на выбор архитектуры обработки звука; (4) найдена бесплатная модель распознавания русской речи GigaAM-v3 (Сбер, MIT-лицензия), по замерам исследования точнее Whisper на русском в 2–8 раз.

Следующий шаг: спецификация на основе этих находок.

## [2026-09-03] artifact | Спецификация PM Assistant (черновик)

Файл: `artifacts/2026-09-03-pm-assistant-spec.md`. Функциональные требования по приоритету P0–P2, построены на зафиксированных решениях + находках исследования. Там, где исследование меняет картину относительно исходных решений (способ подключения к Телемосту, выбор движка распознавания), решение не переписано молча — вынесено в раздел 6 «Открытые вопросы» на ответ пользователя.

Pulse-файл обновлён: Current Focus, Decisions Log, Open Questions, Next Actions, Artifacts.

Следующий шаг: пользователь утверждает спецификацию и отвечает на открытые вопросы. Код приложения не начат.

## [2026-09-03] decision | Телемост: гостевой бот вместо desktop-приложения

Пользователь решил открытый вопрос №1: бот заходит в звонок Телемоста как обычный участник по ссылке и записывает — так же, как для Zoom/Meet, только без официального API. Desktop-приложение с захватом системного звука не делаем. Обновлены: `PM_Assistant.md` (Decisions Log, Open Questions, Current Focus), `artifacts/2026-09-03-pm-assistant-spec.md` (FR-3, раздел 3 архитектура, раздел 6 — вопрос №1 закрыт, вопрос №3 про диаризацию переформулирован под новый способ подключения).

Осталось 6 открытых вопросов. Код приложения не начат.

## [2026-09-03] lint | Переименование Pulse-файла + доработка спецификации

Пользователь переименовал `PM Assistant.md` → `PM_Assistant.md` (без пробела — не срабатывало @-упоминание файла в чате). Синхронизированы ссылки в `CLAUDE.md`, `log.md` (этот файл), `Dashboard.md`, `artifacts/2026-09-03-pm-assistant-spec.md`. Папка проекта осталась `Projects/PM Assistant/` (с пробелом) — переименована только сама Pulse-страница.

Раздел 6 спецификации переструктурирован по типу вопроса: решено (1), проверяется тестом при реализации, не вопрос к пользователю (движок распознавания, диаризация в Телемосте — 2), предложено по умолчанию, требует подтверждения (один пользователь на старте, локальное хранение — 2), настоящий открытый вопрос (152-ФЗ и согласие на запись, формулировка позиционирования — 2).

Следующий шаг: пользователь отвечает на 2 настоящих открытых вопроса и подтверждает 2 предложенных по умолчанию.

## [2026-09-03] decision | Тип продукта и согласие на запись решены

Пользователь ответил на оба оставшихся настоящих вопроса: (1) согласие на запись и 152-ФЗ — без формального процесса, юриста не спрашиваем, голосового объявления в начале записи достаточно; (2) сервис только для личного использования — не команда, не продукт на продажу.

Следствия в `artifacts/2026-09-03-pm-assistant-spec.md`: убран формальный лог согласий (было FR-10), понижен приоритет публичного API (FR-14: P1 → P2), FR-9 упрощён до голосового объявления, вопрос о позиционировании снят как неактуальный. `PM_Assistant.md` обновлён: Decisions Log, Open Questions, Current Focus, AI Brief.

Осталось: подтвердить один default (хранение — локально, без срока). Технические вопросы (движок распознавания, диаризация в Телемосте) решатся тестом на первом шаге реализации, не требуют ответа сейчас. Код приложения не начат.

## [2026-09-03] decision | Хранение — база данных, спецификация полностью решена

Пользователь уточнил последний пункт: расшифровки и настройки приложения — в базе данных, не файлами (заменяет ранее предложенный default «локально, файлами»). Добавлен FR-21 (настройки в БД), уточнён FR-13 (расшифровки в БД). `PM_Assistant.md` и спецификация обновлены: Decisions Log, Open Questions — все пункты закрыты.

Спецификация полностью решена. Осталось только явное «утверждаю» от пользователя на документ целиком — после этого следующий шаг: техническая архитектура и выбор стека для `app/`. Код приложения не начат.

## [2026-09-03] decision | Спецификация утверждена

Пользователь утвердил `artifacts/2026-09-03-pm-assistant-spec.md` целиком («ДА»). Статус документа обновлён на «утверждена». `PM_Assistant.md` обновлён: Decisions Log, Current Focus, Next Actions.

Следующий шаг: техническая архитектура и выбор стека для `app/` — отдельный документ, не начат. Код приложения по-прежнему не пишем.

## [2026-09-03] artifact | Макеты интерфейса (4 экрана)

Сгенерированы через pen.dev CLI (агент Codex, Claude упёрся в лимит сессии до 00:00 Asia/Tbilisi). Папка: `artifacts/designs/`.

Экраны: главная (календарь + «Отправить бота»), итоги встречи (расшифровка / саммари / задачи в Asana), архив с полнотекстовым поиском, настройки (режим записи, Asana, календари).

Следующий шаг: техническая архитектура для `app/`. Итерации макетов: `--in` к нужному `.pen`.

## [2026-09-03] artifact | Макеты в стиле Zigzag Bold Split, все экраны на одном артборде

Стиль из библиотеки pen.dev `get_style`: Zigzag Bold Split, палитра Electric Cobalt, шрифты Anton / Funnel Sans / Geist Mono. Claude и Codex на момент правки были недоступны (лимиты), стиль применён через интерактивный `get_style` + сборка одного `.pen`.

Файлы: `artifacts/designs/00-all-screens.pen` (+ PNG), отдельные экраны `01`–`04` переведены на те же токены.

Следующий шаг: техническая архитектура для `app/`.

## [2026-09-03] artifact | Архитектура первой сдачи и Autopilot BUILD-спек

Стек: Vite + React + TypeScript, Hono на Node, SQLite, отдельный локальный воркер. Решения D1–D4 (воркер на этом Mac, поле ссылки вместо календаря, скрыть Команду/Биллинг, Asana только «к отправке»).

Файлы: `artifacts/2026-09-03-architecture.md`, `.autopilot/2026-09-03-pm-assistant-webapp--wip/spec.md`.

Следующий шаг: нарезка тасков и сборка `app/`.

## [2026-09-03] artifact | Agent SDK на сервере через подписку

Инструкция: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` в окружении процесса, без `ANTHROPIC_API_KEY`. Файлы: `artifacts/2026-09-03-claude-agent-sdk-subscription-on-server.md`, шаблон `.env.example`. Pulse: Decisions Log + Artifacts. Spec Autopilot: имя переменной добавлено в список окружения.

Следующий шаг: при деплое на сервер выпустить токен на Mac и положить в `/etc/pm-assistant.env` (не в git).

## [2026-09-04] artifact | Макеты Style B: остальные экраны

Канон: крем `#FAF7F2`, терракота `#C86B4A`. В `01-home.pen` добавлены экраны Meeting / Archive / Settings / Calendar. PNG: `01-home.png`, `02-meeting.png`, `03-archive.png`, `04-settings.png`, `05-calendar.png`.

Следующий шаг: сверка в UI или сборка `app/` по этим макетам.

## [2026-09-04] artifact | Style B на странице 00 screens

Выбранный вариант собран на артборде `00 screens`: живые копии пяти экранов в `01-home.pen`, страница `00-all-screens.pen` + PNG `00-all-screens.png`. Zigzag-сводка заменена.

## [2026-09-04] session | Autopilot Phase 8: первая сдача app/

Сборка `app/` закрыта: 13 тасков, 63 теста, слепая приёмка на http://127.0.0.1:5173/. Память в `CLAUDE.md` (маркеры Autopilot), ADR `docs/adr/0001`–`0006`, папка прогона `.autopilot/2026-09-03-pm-assistant-webapp/` (суффикс `--wip` снят).

G4: UI жив; без воркера встречи в очереди; с воркером карточка «Готово» по фикстуре. Живой вход в звонок и распознавание с микрофона без ключей не работают.

Следующий шаг: ключи в `.env` и проверка на настоящем созвоне.

## [2026-09-04] artifact | UI-проход Style B по 00-all-screens

Экраны `app/` приведены к канону `artifacts/designs/00-all-screens.pen`: крем `#FAF7F2`, терракота `#C86B4A`, светлый сайдбар. Таски T14–T19. 74 теста зелёные.

Следующий шаг: открыть http://127.0.0.1:5173/ и сверить с макетами глазами.

## [2026-09-04] setup | MVP на EC2 16.171.52.89

На существующем AWS EC2 (рядом с ArianaTent и Career-ops): Node 24 в `/opt/node-24`, `/etc/pm-assistant.env` (Zoom с локального `app/.env`, chmod 600), systemd API+воркер, nginx на `127.0.0.1:5173`, Docker-образ `pm-assistant-zoom-bot`, whisper.cpp + `ggml-tiny.bin`. Health: API :8787, воркер жив, `recordingModeDefault=local_audio`. Caddy не ставили (nginx уже на 80/443). AWS CLI нет, 8787 наружу не открывали.

Следующий шаг: SSH-туннель на :5173, allowlist Zoom Marketplace (`localhost`, `127.0.0.1`), токен LLM / Meet / Asana вручную.

## [2026-09-04] session | Zoom: бот больше не задвоевает звук

Бот входил в звонок с живым микрофоном и колонками: голос шёл и с клиента пользователя, и с бота. Исправление: тихий `getUserMedia`, `--mute-audio`, `ZoomMtg.mute` и кнопка Mute после входа. Запись чужих дорожек остаётся. Образ `pm-assistant-zoom-bot` на EC2 пересобран. Регрессия: `zoom-bot-mute.test.ts`. Полный `npm test`: 86 тестов до правки, плюс этот кейс.

Следующий шаг: повторный живой звонок, бота пускать из waiting room.

## [2026-09-04] session | Zoom-бот не входил: Playwright 1.62 vs образ 1.55

Воркер на EC2: `Executable doesn't exist ... chrome-headless-shell`. В Docker `npm install` без lockfile поставил Playwright 1.62.1, базовый образ остался `v1.55.0-jammy`. Chromium не стартовал ни до мьюта, ни после. Встреча оставалась `queued`, повтор той же ссылки возвращал alreadyRunning. Исправление: Playwright 1.55.0 + `npm ci` + lockfile в образе; задание при ошибке помечается failed, встреча `error`. `npm test`: 88/88.

Следующий шаг: пересобрать образ на EC2 без кэша npm, сбросить застрявшую встречу, снова отправить ссылку.

## [2026-09-04] session | Перезапуск бота со страницы Настройки

Шестерёнку у кнопки «Бот» на Главной не делали. На Настройках секция «Сервис бота» и диалог «Нужно ли перезапустить бота?» (Да / Нет). `POST /api/bot/restart` снимает контейнеры Docker (метка `pm-assistant.role=zoom-bot` и ancestor образа), leftover `join.mjs`, встречи в конвейере и задания pending/running, на EC2 перезапускает воркер (`Restart=always`, без sudoers). На Mac воркер не убивается. Главную не трогали.

Следующий шаг: выкатить код и юнит воркера на EC2, `systemctl daemon-reload`.

## [2026-09-04] session | В очередь: прод STT

В Next Actions Pulse добавлены незакрытые пункты субагента прод STT: библиотеки whisper.cpp на EC2, выкат STT-кода и образа бота (Playwright 1.55), расшифровка уже сохранённого wav. Локальный код STT уже есть; на сервере в карточке ещё заглушка.

Следующий шаг: выкат на EC2 (перезапуск бота + whisper) и CLI-расшифровка wav.

## [2026-09-04] session | Живая расшифровка на EC2: whisper .so + сохранённый wav

Корневая причина: `whisper-cli` падал без `libwhisper.so.1`. На EC2 пересобрали whisper.cpp с shared-библиотеками, `ldconfig`, обёртка `/usr/local/bin/whisper`. Скрипты: `artifacts/deploy/install-whisper.sh`, `doctor.sh`, `sync.sh`, `transcribe-meeting.sh`; `bootstrap.sh` вызывает установку целиком, не один бинарь. Образ `pm-assistant-zoom-bot` пересобран (Playwright 1.55). CLI расшифровал wav встречи: 3 сегмента живого текста вместо заглушки. Юниты api+worker active. Локально 18 тестов pipeline/status/meeting-detail/stt зелёные.

Следующий шаг: Zoom Marketplace allowlist (`localhost`, `127.0.0.1`) и пускать бота из waiting room; ключ LLM для нормального резюме.

## [2026-09-04] session | Пользователь подтвердил прод: allowlist, waiting room, ключ LLM

Пользователь подтвердил, что Zoom Marketplace allowlist (`localhost`, `127.0.0.1`), допуск бота из waiting room и ключ языковой модели в `/etc/pm-assistant.env` на проде уже сделаны. Meet и Asana не подтверждены.

Следующий шаг: повторный живой звонок; `GOOGLE_CLIENT_*` и `ASANA_PAT` ещё открыты.

## [2026-09-04] session | Кнопка перезапуска бота в прод-UI

На EC2 исходники `POST /api/bot/restart` и `Restart=always` уже были; nginx отдавал старый `dist/` без «Перезапустить бота». Пересобран UI Node 24 (`vite` поставили как инструменты сборки), юнит воркера переложен, api+worker перезапущены. STT/whisper не трогали. Соседи ArianaTent и Career-ops не трогали.

Следующий шаг: повторный живой звонок; `GOOGLE_CLIENT_*` и `ASANA_PAT`.

## [2026-09-04] artifact | Fireflies UX и прототип Главная + расшифровка

Разобран [fireflies.ai](https://fireflies.ai/) как аналог (дизайн-система, компоновка, фичи vs PM Assistant). 10 UI-правок по убыванию эффекта. Новый прототип двух экранов: `artifacts/designs/02-home-transcript-v2.pen`. Разбор: `artifacts/2026-09-04-fireflies-ux-10-edits.md`. Канон `00-all-screens.pen` / `01-home.pen` не перезаписывали.

Следующий шаг: открыть v2 в Pencil и решить, какие правки переносить в живой UI.

## [2026-09-04] session | Прод: очередь, 429, whisper small

Кнопка «Повторить» била в `POST /retry` (join). После 429 бот снова входил в закончившийся звонок, встреча зависала в joining, два Docker-бота ели RAM, `running` не отдавал очередь. Исправлено: при `audio_path` retry/кнопка ставят `transcribe`; stale `running` сбрасываются; воркер один job за раз. LLM 429: backoff 2/4/8 с, затем резюме из текста и `ready`. Модель `ggml-small.bin` (466 МБ). Три wav перерасшифрованы, pending/running=0. Соседей ArianaTent и Career-ops не трогали.

Следующий шаг: повторный живой звонок; `GOOGLE_CLIENT_*` и `ASANA_PAT`.

## [2026-09-04] artifact | Аудио с прода для регрессии качества записи

Скачаны 5 файлов (3 wav + 2 webm) с `/opt/pm-assistant/app/data/audio/` в `artifacts/audio-regression-2026-09-04/`. Сервисы и код не трогали.

## [2026-09-04] artifact | Локальная расшифровка трёх wav регрессии (openai-whisper turbo)

Три файла из `artifacts/audio-regression-2026-09-04/` прогнаны локально `/opt/homebrew/bin/whisper --model turbo --language ru` (кэш `~/.cache/whisper/large-v3-turbo.pt`). Рядом: `*.ru.txt` и `*.json`. EC2, systemd и код воркера не трогали.

## [2026-09-04] session | Ревью расшифровки до саммари

После Whisper текст идёт в `reviseTranscript` (до 3 проходов LLM), в БД пишется уже исправленный транскрипт, саммари только по нему. При 429/падении ревью: сырой STT, резюме из текста, встреча `ready`, в UI пометка. Тесты llm/pipeline/MeetingView. Выкат: `sync.sh`, `vite build`, restart worker. HTTP API не меняли. Соседей ArianaTent и Career-ops не трогали.

Следующий шаг: повторный живой звонок или «Повторить транскрибацию» на старом wav; `GOOGLE_CLIENT_*` и `ASANA_PAT`.

## [2026-09-04] decision | Прототип v2: проекты, Jira Epic, сворачиваемый сайдбар

В `02-home-transcript-v2.pen`: запись принадлежит проекту; на Главной счётчики расшифровок по проектам и поля Jira/Epic на карточке; полоса Asana с Главной снята; задачи на экране встречи («Создать в Epic ROAD-100»). Сайдбар сворачивается (~64px). Добавлены кадры Архив, Календарь, Настройки. Канон `00-all-screens.pen` / `01-home.pen` не трогали. Живой код и спека пока Asana.

Следующий шаг: комментарии по кадрам в Pencil; внедрение Jira в код только по отдельной просьбе.

## [2026-09-05] decision | Прототип v2: таблица проектов, вход, аватар

В `02-home-transcript-v2.pen`: на `v2 Настройки` таблица проектов (имя, URL Jira, Epic, число расшифровок) с добавлением, правкой и удалением в строке. Экрана проекта нет. Под таблицей два блока одной ширины: режим записи и интеграции. Google Календарь: статус и кнопки Подключить / Отключить. Jira: кнопка «Подключить Jira» (OAuth), отдельно от полей в таблице. Кадр `v2 Вход`. Аватар Илья / ИВ в подвале сайдбара (развёрнут: имя + Выйти; свёрнут: только круг). Канон `00-all-screens.pen` / `01-home.pen` не трогали. Живой код без входа и пока Asana.

Следующий шаг: внедрение входа и Jira в `app/` только по отдельной просьбе.

## [2026-09-05] artifact | Прототип v2: Google OAuth на входе

В `02-home-transcript-v2.pen` на `v2 Вход`: кнопка «Войти через Google», разделитель «или», затем почта/пароль и «Войти». Подсказка про сессию в браузере. Документы: дополнение в `artifacts/2026-09-04-fireflies-ux-10-edits.md`, Decisions Log в `PM_Assistant.md`. Живой код не трогали; для auth: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, callback и сессия.

Следующий шаг: handoff `2026-09-05-v2-ui-implementation-handoff.md` или внедрение auth в `app/` по просьбе.

## [2026-09-05] artifact | Handoff v2 UI → код

Файл: `artifacts/2026-09-05-v2-ui-implementation-handoff.md`. Сводка для агента-архитектора: 6 кадров `02-home-transcript-v2.pen`, дельты vs `app/`, каталог компонентов, схема projects/auth/Jira, фазы внедрения. Pulse: Artifacts + Next Actions.

## [2026-09-05] artifact | Прототип v2: подвал сайдбара прижат к вьюпорту

В `02-home-transcript-v2.pen`: компоненты `Sidebar` и `Sidebar Collapsed` высотой 900px (`space_between`); инстансы на рабочих кадрах больше не `fill_container` по высоте. Подвал (аватар / Выйти, заметка календаря, локальные МБ) остаётся на нижней кромке видимого кадра; лишняя высота Главной (1540) и Настроек (1280) только в колонке контента. Канон `00-all-screens.pen` / `01-home.pen` не трогали.

## [2026-09-05] artifact | v2 UI: каталог элементов, spec и tasks

MCP Pencil: полный обход `02-home-transcript-v2.pen` (6 кадров + Sidebar). Gap analysis vs `app/`. Создано: `artifacts/2026-09-05-v2-ui-elements-changelog.md`; `.autopilot/manifest.md`, `plan.md`, `spec.md`, `tasks.md`; обновлены `state.js`, handoff (расхождения: нет «Проекты» в nav, вкладки на расшифровке). Код `app/` не трогали.

Следующий шаг: утвердить spec/tasks, затем `/autopilot продолжи`.

## [2026-09-05] artifact | Прототип v2: ссылки на входе

В `02-home-transcript-v2.pen` на `v2 Вход`: «Забыли пароль?» справа в строке метки пароля; «Зарегистрироваться» по центру под «Войти». Порядок карточки: Google → «или» → почта → пароль → «Войти» → регистрация. Handoff §3.1, §4.3 и критерии приёмки; дополнение в `2026-09-04-fireflies-ux-10-edits.md`. Живой код не трогали.

## [2026-09-05] pulse | Синхронизация Pulse после v2 handoff

## [2026-09-05] decision | PO: multi-tracker, без табов, global save, OAuth ADR

Сессия PO 2026-09-05: Jira-only override снят → выбор трекера (Asana/Trello/ClickUp/Notion, default ClickUp); расшифровка без вкладок; глобальная «Сохранить» в таблице проектов; один Google OAuth client; auth P0 = login+Google, register/forgot фаза 1.5; `asana_state` → `tracker_state` + `tracker_type`; миграция в v2 wave сразу. Обновлены: `PM_Assistant.md`, `.autopilot/manifest.md`, `spec.md`, `tasks.md`, `state.js`, handoff, changelog §10. Код `app/` не трогали.

Открыто: подтвердить ClickUp vs ClickHouse. Следующий шаг: `/autopilot продолжи` (wave 1).

## [2026-09-05] decision | ClickUp подтверждён (не ClickHouse)

PO подтвердил ClickUp в списке трекеров; закрыт open question, обновлены `PM_Assistant.md`, `manifest.md`, `tasks.md`, `state.js`, changelog §10. Spec `approved-with-amendments`, build ready wave 1.

## [2026-09-05] session | v2 wave 1: БД, auth API, Login

Wave 1 build в `app/`: миграция SQLite (projects, users, sessions, integration_tokens, meetings.project_id, action_items tracker_*), типы shared, auth routes + session middleware, страница `/login` (Google + email/password, stubs register/forgot). Тесты: 128 passed. Следующий шаг: T-V2-05 Sidebar v2 + route guard.

## [2026-09-05] session | v2 wave 2 partial: Sidebar, guard, Projects API

T-V2-05..07 в `app/`: Sidebar v2 (256/64, sticky footer, storage, avatar, logout, без «Интеграций»), RequireAuth + redirect `/integrations` → `/settings#integrations`, Projects CRUD + summary API. Deploy gate зафиксирован (T-V2-DEPLOY blocked). Тесты: 141/141. Следующий: T-V2-08 Settings table.

Зафиксирован порядок: waves 1–7 в коде → локальный acceptance → T-V2-DEPLOY (EC2 + prod QA). Обновлены `.autopilot/manifest.md`, `tasks.md`, `state.js` (`deployGate`, stage deploy blocked). Агент деплоя 07b54e0c запущен ранее, полный prod QA отложен до done T-V2-01…22.

## [2026-09-05] artifact | Версионность дашбордов Autopilot

Снапшоты в `.autopilot/dashboards/` (v2-ui-2026-09-05, legacy-mvp-2026-09-03); `index.html` — список версий; `state.js` → `dashboardLatest`.

Канон версий: `CHANGELOG.md` (не `log.md` и не каталог UI v2). Скрипт `artifacts/deploy/record-release.mjs` дописывает секцию semver из `app/package.json` при каждом `sync.sh`; копия на EC2: `/opt/pm-assistant/CHANGELOG.md`. Состояние: `artifacts/deploy/release-state.json`. Пропуск: `SKIP_RELEASE_NOTES=1`.

## [2026-09-05] artifact | RCA: пауза перед T-V2-08

Координатор резал Task-прогоны по волнам (Wave 1; затем T-V2-05/06 + «по возможности 07») и сам ставил human-gate «напиши /autopilot продолжи». Пользователь, PO spec и skill `semi` паузу не заказывали. Разбор: `artifacts/2026-09-05-autopilot-stop-rca.md`.

## [2026-09-05] session | v2 build T-V2-08..19 (сессия остановлена)

Autopilot продолжен без пауз на волнах (режим 2, один фоновый агент). Сделано в `app/`: T-V2-08..11 (Settings, Home+projectId), T-V2-12 audio, T-V2-13 MeetingView v2 (60/40, плеер, tracker CTA, без слайдов), T-V2-14 ask stub, T-V2-15 search projectId, T-V2-16 Archive chips+Epic, T-V2-17 Calendar banner+CTA, T-V2-18/19 tracker adapter + `tracker-create-tasks`. Частично: T-V2-20 (worker `maybeAutoSendTracker`, asana-queue ещё в API), T-V2-21 (`.env.example` tracker vars, CLAUDE.md нет). Регрессия: `npm test` 160/160, `npm run build` OK; ручной чеклист manifest не прогнан. T-V2-DEPLOY не начинали. Обновлены `.autopilot/state.js`, `tasks.md`, dashboard sync.

## [2026-09-05] lint | Settings: пустой экран при старом API

Причина: `SettingsPage.tsx` требовал одновременно `GET /api/settings` и `GET /api/projects`; локальный API на :8787 был запущен до v0.2.0 и отвечал 404 на `/api/projects`, из-за чего оставался только заголовок «Не удалось загрузить настройки». На EC2 оба эндпоинта 200. Исправление: настройки грузятся отдельно от проектов; при ошибке проектов форма (режим записи, интеграции, бот) остаётся, в таблице показывается подсказка про перезапуск `npm run dev`. Тест: `SettingsPage.test.tsx`. Prod deploy не нужен для этого фикса, если API уже 0.2.0.

## [2026-09-05] artifact | Аудит кода (Composer 2.5)

Независимое ревью `app/` v0.2.0: отчёт P0/P1, архитектура, Supabase; протокол из 55 атомарных проверок. Папка `artifacts/audit/`: `2026-09-05-composer-2.5-code-review.md`, `2026-09-05-composer-2.5-verification-protocol.md`. Ссылки в `PM_Assistant.md` Artifacts. Прогон протокола не выполнялся (все `todo`).
