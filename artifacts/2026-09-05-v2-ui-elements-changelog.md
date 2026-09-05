# PM Assistant v2: каталог UI-элементов и changelog

**Дата:** 2026-09-05  
**Источник дизайна:** [design-mockup-version-2.pen](designs/design-mockup-version-2.pen) (MCP Pencil, полный обход кадров)  
**Сравнение v1:** [00-all-screens.pen](designs/00-all-screens.pen), [01-home.pen](designs/01-home.pen), живой код `app/src/web/` (Style B MVP)  
**Связанные документы:** [handoff](2026-09-05-v2-ui-implementation-handoff.md), [Fireflies UX](2026-09-04-fireflies-ux-10-edits.md)

---

## 1. Сводка «было → стало» (информационная архитектура)

| Область | v1 (код + макет 00) | v2 (design-mockup-version-2.pen) |
| --- | --- | --- |
| Вход | Нет, Shell открыт всем | Кадр `v2 Вход`, маршрут `/login`, вне Shell |
| Сайдбар | Фиксированный ~256px, пункт «Интеграции», без аватара | 256px / 64px, без «Интеграции», липкий подвал, аватар + «Выйти» |
| Навигация | Главная · Календарь · Расшифровки · Интеграции · Настройки | Главная · Календарь · Расшифровки · Настройки (пункта «Проекты» **нет**) |
| Проекты | Нет сущности | CRUD в Настройках, picker на Главной, чип на встрече/архиве |
| Трекер задач | Asana (`asanaState`, очередь на Главной) | **Multi-tracker** (Asana/Trello/ClickUp/Notion), CTA «Создать N задач» |
| Главная | Hero «ближайшая встреча», «Бот свободен», узкая форма справа | Доминирующий блок «Отправить бота», степпер, карточки проектов |
| Расшифровка | 3 равные колонки, слайды, Asana CTA | ~60/40, плеер, поиск, правая колонка **без табов**, ask-поле |
| Архив | Фильтры платформа / период | Фильтры **проект** / статус, Epic в детали |
| Календарь | Локальный список, везде «Открыть» | Баннер «выключен», CTA по статусу встречи |
| Настройки | Asana-тоггл, label проекта | Таблица проектов, **глобальная «Сохранить»**, picker трекера, интеграции 50/50 |

---

## 2. Общие компоненты

### 2.1 Sidebar (`XGwhN` / `Yk8fg`)

| Элемент | Назначение | Состояния | API / данные |
| --- | --- | --- | --- |
| Brand mark + «PM Assistant» | Идентификация | expanded only | статика |
| Кнопка свернуть / развернуть | Toggle 256↔64 | expanded: «<»; collapsed: «>» | `localStorage.sidebarCollapsed` |
| Nav: Главная, Календарь, Расшифровки, Настройки | Маршрутизация | active: терракотовая полоска слева | React Router |
| Note «Календарь выключён» | Честный статус | всегда в v2 | флаг интеграции (stub OK) |
| Storage «N расшифровок · M МБ» | Локальное хранилище | expanded: полный текст; collapsed: «184» МБ | `GET /api/meetings` storage |
| Avatar «ИВ» + имя + «этот компьютер» | Сессия | expanded: полный блок; collapsed: круг | `GET /api/auth/session` |
| «Выйти» | Logout | expanded only | `POST /api/auth/logout` |

**Поведение:** рейка `min-h-screen` / 900px в макете, `justify-between`: навигация сверху, подвал снизу; скролл только в `workspace`.

### 2.2 Topbar search (Главная, Архив)

| Элемент | Состояния | Поведение | API |
| --- | --- | --- | --- |
| Поле «Найти встречу или фразу» | empty, focus, filled | submit → `/archive?q=...` | `GET /api/search?q=` |

---

## 3. `v2 Вход` (`WcCtE`, `/login`)

| Элемент | Тип | Состояния | Функционал | API / БД |
| --- | --- | --- | --- | --- |
| Login Mark + «PM Assistant» | brand | static | — | — |
| «Вход» + подпись про закрытие доступа | заголовок | static | копирайт из макета | — |
| «Войти через Google» | primary outline | idle, `google_redirecting` (disabled) | OAuth redirect | `GET /api/auth/google/start` |
| Разделитель «или» | text | static | — | — |
| Поле «Почта» | input | empty, filled, error | локальный аккаунт | `users.email` |
| «Пароль» + «Забыли пароль?» | input + link | empty, masked, error | вход / фаза 1.5 reset | `POST /api/auth/login`, `/forgot-password` |
| «Войти» | CTA терракотовая | idle, `submitting`, error | локальный вход | `POST /api/auth/login` |
| «Зарегистрироваться» | link `#C86B4A` | static | фаза 1.5 | `/register` |
| Подсказка про сессию (в handoff) | text | — | **в текстовых слоях MCP не найдена** | — |

**Удалено vs v1:** оболочка Shell, прямой доступ к `/`.

**Открытый вопрос PO:** нужна ли нижняя подсказка про сессию в браузере (есть в handoff, нет в текущих слоях `.pen`)?

---

## 4. `v2 Главная` (`MY7XW`, `/`)

### 4.1 Шапка

| Элемент | Состояния | API |
| --- | --- | --- |
| «Главная» | static | — |
| «24 расшифровки в 4 проектах» | dynamic | `GET /api/projects/summary` |
| Search | см. §2.2 | `GET /api/search` |

### 4.2 Блок «Отправить бота на звонок» (доминирующий)

| Элемент | Состояния | Функционал | API |
| --- | --- | --- | --- |
| Card title + helper | static | пояснение про проект | — |
| Link input | empty, valid URL, invalid | URL встречи | `detectPlatform` |
| Project picker (чип «Свои») | closed, open, empty | выбор `projectId` | `GET /api/projects`; default `localStorage` |
| «Отправить бота» | idle, busy, error | создать встречу | `POST /api/meetings { url, projectId }` |
| Platform chips (Zoom / Meet / Телемост) | static | подсказка платформ | — |
| «Распознан Google Meet» | detected / hidden | после parse URL | клиентский `detectPlatform` |

### 4.3 Живая полоса (live call)

| Элемент | Состояния | API |
| --- | --- | --- |
| Название + meta (длительность · платформа · проект) | live / idle | `GET /api/meetings` filter live |
| Stepper 5 шагов | queued→joining→recording→transcribing→summarizing→ready / error | `MeetingStatus` |
| «Запись: идёт звук» | active step caption | status `recording` |
| «Открыть» | enabled when meeting exists | `/meetings/:id` |

### 4.4 Блок «Проекты»

| Элемент | Содержимое | API |
| --- | --- | --- |
| Заголовок + сводка | «Проекты», счётчик | `GET /api/projects/summary` |
| Карточка проекта | имя, «последняя …», Jira key, Epic, «N расшифровок» | per-project aggregate |
| Проект «Свои» | в picker по умолчанию; **в карточках на макете 3 из 4** (без «Свои») | seed project |

### 4.5 Колонки

| Колонка | Элементы | API |
| --- | --- | --- |
| «Следующие по ссылке» | время, название, платформа·проект, pill, CTA «Отправить бота» | scheduled meetings / saved URLs |
| «Последние расшифровки» | карточки: title, status chip, meta, snippet headline; ссылка «Все» | `GET /api/meetings` recent |

### 4.6 Удалено vs v1 (код `HomeView.tsx`)

- Hero-карточка «ближайшая live-встреча» как календарь
- Aside «Бот свободен / занят»
- Узкая боковая форма
- Полоса хранилища в % от 2 ГБ
- Очередь / полоса Asana

---

## 5. `v2 Расшифровка` (`oggFA`, `/meetings/:id`)

**Сайдбар:** collapsed по умолчанию (`Yk8fg`).

### 5.1 Шапка

| Элемент | API / БД |
| --- | --- |
| Крошка «Главная» | Link `/` |
| Название встречи | `meetings.title` |
| Чип проекта «Roadmap Q4» | `projects.name` via `meetings.project_id` |
| Бейдж «Готово» | `meetings.status` |
| Meta «14 авг · 42 мин · Zoom · Epic ROAD-100» | meeting + project |

### 5.2 Плеер

| Элемент | Состояния | API |
| --- | --- | --- |
| Play/pause | playing, paused, hidden (mode `text`) | `GET /api/meetings/:id/audio` |
| Progress «18:24 / 42:10» | seek | Range requests |
| Speed «1×» | 0.5×, 1×, 1.5×, 2× | клиент |
| Volume, Download | optional P1 | audio file |

### 5.3 Поиск и фильтры транскрипта

| Элемент | Состояния | Поведение |
| --- | --- | --- |
| Search field | empty, results | запрос «бюджет Q4» |
| «3 совпадения» + prev/next | 0, N, active index | клиентский индекс по `transcript` |
| Подсветка `<mark>` в строке | active match | scroll + playhead |
| Чипы: Все, Илья, Ника, Сергей, Вопросы, Решения, Задачи | selected / muted | спикер: сразу; семантика: stub/LLM P2 |

### 5.4 Левая колонка (~60%): транскрипт

| Элемент | Состояния | API |
| --- | --- | --- |
| Строка: аватар буквы, имя, таймкод `#C86B4A`, текст | default, `playhead`, bookmark | `transcript_segments` |
| «сейчас играет» на активной реплике | playhead | audio sync |

### 5.5 Правая колонка (~40%)

**Замечание (PO 2026-09-05):** вкладки «Обзор»/«Задачи» **не делаем**. Единая прокручиваемая правая колонка: обзор + задачи + CTA трекера.

| Элемент | Содержимое | API |
| --- | --- | --- |
| Счётчики | фрагмента / решения / задачи | aggregate |
| Headline, Решения, Риски, Следующий шаг | markdown lines | `summaries` |
| «Задачи встречи» + meta «3 из 4 к созданию» | список с таймкодом | `action_items` |
| Статусы задач | «к созданию» / «не создана в Jira» | `jira_state` (новое поле) |
| «Создать 3 задачи Jira» | idle, busy, disabled (no OAuth) | `POST .../jira-create-tasks` |
| Jira hint | static | — |

### 5.6 «Спросить по этой встрече»

| Состояние | UI |
| --- | --- |
| idle | input + chips «Какие решения?», «Что в Epic?» |
| loading | spinner на send |
| answer | текст ответа над полем (на макете показан пример) |

API: `POST /api/meetings/:id/ask` (stub P1).

### 5.7 Удалено vs v1 (`MeetingView.tsx`)

- Три равные колонки
- Секция «Слайды»
- CTA Asana, `asanaProjectLabel`
- «+ Новое»

---

## 6. `v2 Архив` (`OuL9Y`, `/archive`)

| Элемент | Состояния | API |
| --- | --- | --- |
| Шапка + search | как Главная | `GET /api/search` |
| Чипы проектов | Все, Свои, …, single-select | `projectId` filter |
| Чипы статусов | Готово, Запись | `status` filter |
| Карточка списка | title, status, meta (платформа·длительность·дата·**проект**), snippet | search hits |
| Деталь справа | title, meta, **Epic chip**, summary, счётчики, «Открыть встречу» | meeting detail |

**Удалено vs v1:** первичные фильтры Zoom/Meet/Телемост и период; «Лучшее совпадение» без Epic.

---

## 7. `v2 Календарь` (`gsvqb`, `/calendar`)

| Элемент | Состояния | API |
| --- | --- | --- |
| Subtitle «Выключен. Бот идёт только по ссылке» | static | — |
| Banner | info | — |
| Строка встречи | время, title, платформа·проект, URL | `GET /api/meetings` |
| CTA | «Открыть» (live/ready) / «Отправить бота» (ещё не записано) | status + `POST /api/meetings` |

**Сайдбар:** collapsed.

---

## 8. `v2 Настройки` (`Uxgjf`, `/settings`)

### 8.1 Таблица проектов

На одном кадре показаны **все режимы строки** (демо состояний):

| Режим | Пример строки | UI |
| --- | --- | --- |
| `view` | Свои, Onboarding | текст + «изменить» / «удалить» |
| `edit` | Roadmap Q4 | инпуты + «Сохранить» / «Отмена» |
| `delete_confirm` | Клиентский прототип | «Удалить этот проект?» + Да/Отмена |
| `new` | пустая строка | placeholders + «Сохранить» / «Отмена» |

Колонки: Проект, Ключ/URL Jira, Epic, Расшифровок, действия.

| API | Правила |
| --- | --- |
| `GET/POST/PUT/DELETE /api/projects` | DELETE 409 если `meeting_count > 0` |
| «Добавить проект» | вставка строки `new` |
| «Сохранить» (глобальная) | commit всех изменённых строк таблицы | `PUT /api/projects/batch` |

### 8.2 Режим записи (50%)

3 radio: Только текст / Локальный звук / Полная запись + подпись про русский STT.

API: `GET/PUT /api/settings` (`recordingModeDefault`).

### 8.3 Интеграции (50%)

| Блок | Состояния | API |
| --- | --- | --- |
| Google Календарь | disconnected / connected | OAuth stub + `integration_tokens` |
| Jira | disconnected / connected | `GET /api/integrations/jira/start` |
| Локальный список встреч | always active | static |

### 8.4 Сохранено из v1

- «Перезапустить бота» → `POST /api/bot/restart`

### 8.5 Удалено vs v1

- Тумблер `asanaAutoSend`
- Поле `asanaProjectLabel`
- Список Outlook в календарях (на макете только Google + локальный)

---

## 9. Матрица gap: элемент → код → изменения

| UI v2 | Текущий код | FE | BE / DB |
| --- | --- | --- | --- |
| `/login` gate | нет | `LoginPage`, route guard в `App.tsx` | `users`, `sessions`, auth routes |
| Google OAuth | env есть, UI нет | кнопка на login | `GET /api/auth/google/*` |
| Sidebar collapse | фиксированный `Sidebar.tsx` | state + CSS 256/64 | — |
| Avatar / Выйти | нет | footer sidebar | `GET /api/auth/session`, logout |
| Убрать «Интеграции» | `Sidebar` item + route | удалить/редирект | — |
| Project picker | нет | `HomeView` | `projects`, `meetings.project_id` |
| Live stepper | статусы в списке | компонент Stepper | статусы уже есть |
| Projects block Home | нет | секция карточек | `GET /api/projects/summary` |
| Meeting 60/40 + player | 3 колонки | рефактор `MeetingView` | `GET .../audio` |
| Transcript search highlight | фильтр списка | search UI | клиент / FTS P2 |
| Tabs overview/tasks | одна колонка задач | tabs или scroll panel | — |
| Jira CTA | Asana CTA | замена копирайта | `jira-create-tasks`, adapter |
| Ask field | нет | input + chips | stub endpoint |
| Archive project chips | platform filters | chip group | `search?projectId=` |
| Archive Epic detail | нет Epic | detail panel | join projects |
| Calendar CTA split | всегда «Открыть» | conditional button | status check |
| Settings project table | Asana block | CRUD table | `/api/projects` |
| Jira/Google OAuth UI | stub calendars list | integration cards | `integration_tokens` |

---

## 10. Открытые вопросы для PO (все закрыты 2026-09-05)

| # | Вопрос | Решение PO |
| --- | --- | --- |
| 1 | Nav «Проекты» в сайдбаре | Без пункта; блок только на Главной |
| 2 | Вкладки «Обзор»/«Задачи» | Без tab UI; единая правая колонка |
| 3 | Глобальная «Сохранить» | Глобальная кнопка; per-row edit/cancel |
| 4 | Подсказка про сессию на Входе | Опционально P1 |
| 5 | Register / forgot-password | Фаза 1.5; заглушки на P0 OK |
| 6 | Google OAuth client | Один client, если возможно (ADR spec §8) |
| 7 | Asana → multi-tracker | `tracker_state` + `tracker_type`; wave 1 |
| 8 | ClickUp vs ClickHouse | **ClickUp** (опечатка в исходном списке); default `clickup` |

---

## 11. Вне скоупа v2 (не копировать из макета/конкурентов)

- Отдельный экран `/projects/:id`
- Вложенный список встреч в таблице Настроек
- Очередь задач на Главной
- Живой sync Google Calendar в P0
- Секция «Слайды», voiceprint в UI
- Маркетинг Fireflies (Fred, фиолетовый, Skills)
