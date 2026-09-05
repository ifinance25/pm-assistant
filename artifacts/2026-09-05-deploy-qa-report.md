# PM Assistant: деплой и QA на EC2

**Дата:** 2026-09-05 (финальный прогон autopilot v2-ui)  
**Версия:** 0.2.0 (`app/package.json`)  
**Коммит (локально):** `4e3054f`  
**Хост:** `ubuntu@16.171.52.89` (только localhost, без публичного DNS)

---

## Локальная регрессия (T-V2-22)

| Шаг | Результат |
|-----|-----------|
| `npm test` | **160/160 pass** (41 файл, Vitest) |
| `npm run build` | **OK** (Vite dist, 74 modules) |

---

## Деплой: что сделано

1. **sync.sh** (rsync `app/` + `deploy/` → `/opt/pm-assistant/`). `record-release.mjs` записал 0.2.0 в `CHANGELOG.md`.
2. **На сервере:** `npm install` (с dev для vite), `npm rebuild better-sqlite3`, `npm run build`.
3. **systemd:** unit-файлы из `deploy/`, `daemon-reload`, `restart pm-assistant-api pm-assistant-worker` → оба **active**.
4. **zoom-bot:** остановлены и удалены контейнеры с меткой `pm-assistant.role=zoom-bot` (чистый старт при следующем join).
5. **doctor.sh:** всё OK (whisper, docker-образ `pm-assistant-zoom-bot`, SQLite, последние встречи).

---

## Доступ к prod

Публичного URL нет. UI и API слушают только `127.0.0.1` на сервере.

**SSH-туннель с Mac:**

```bash
ssh -i "/Users/ifinance/Documents/AI2026/AWS Server/TEST Key.pem" \
  -L 5173:127.0.0.1:5173 \
  ubuntu@16.171.52.89
```

**Браузер:** http://127.0.0.1:5173/

**Учётная запись для входа в приложение**

- Email: `admin@pm-assistant.local`
- Пароль: в `/etc/pm-assistant.env` на сервере (`PM_ASSISTANT_AUTH_PASSWORD`), не в git.

---

## Тест-план и результаты (curl на сервере, 127.0.0.1)

| ID | Область | Шаги | Ожидание | Результат |
|----|---------|------|----------|-----------|
| FT-01 | Health | GET `/api/health` | 200, `workerAlive: true` | **PASS** |
| FT-02 | Auth | POST `/api/auth/login` email/password | 200, cookie `pm_assistant_session` | **PASS** |
| FT-03 | Auth guard | GET `/api/meetings` без cookie | 401 | **PASS** |
| FT-04 | Settings | GET `/api/settings` с сессией | 200 | **PASS** |
| FT-05 | Home flow | POST `/api/meetings` `{url, projectId}` | 201 или 200 | **PASS** (201) |
| FT-06 | UI | GET `/` и `/login` через nginx :5173 | 200 | **PASS** |
| FT-07 | Worker | heartbeat в `/api/health` | `workerAlive: true` | **PASS** |
| FT-08 | Version | JS-бандл из `dist/` | содержит `0.2.0` | **PASS** |
| FT-10 | Projects API | `projectsRouter` в `app.ts` | маршрут есть | **PASS** |

**Итого функциональных проверок:** **9/9 PASS** (FT-01…08 + FT-10).

---

## Блокеры и замечания

1. **Первый `npm install --omit=dev` на сервере:** vite не найден при build. Обход: полный `npm install` перед `npm run build`.
2. **Тестовая встреча:** POST FT-05 создал queued-встречу с URL `https://zoom.us/j/99999999999?pwd=testqa` (stub). Можно удалить из архива вручную.
3. **Zoom stub-ошибки в БД:** старые встречи в статусе `error` (бот Zoom). Не регрессия v0.2.0; живой звонок не входил в scope QA.

---

## Next actions (вне autopilot)

- [ ] Ручной smoke через браузер по туннелю: login → settings → archive → meeting detail.
- [ ] Повторный живой Zoom/Телемост звонок на prod (основной продуктовый критерий).
- [ ] Закрыть `GOOGLE_CLIENT_*` / токены трекеров в env, если нужны интеграции v2.

---

## Команды для повторной проверки на сервере

```bash
bash /opt/pm-assistant/deploy/doctor.sh
curl -sS http://127.0.0.1:8787/api/health
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5173/login
```
