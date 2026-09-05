# PM Assistant на EC2

Хост: `ubuntu@16.171.52.89` (`ip-172-31-23-161`). Рядом остаются ArianaTent и Career-ops, их юниты не трогали.

Публичного DNS у PM Assistant нет. API и UI слушают только localhost. **v2:** экран входа обязателен; учётные данные в `/etc/pm-assistant.env` на сервере.

## Как открыть

С Mac (ключ с пробелом в имени, путь в кавычках):

```bash
ssh -i "/Users/ifinance/Documents/AI2026/AWS Server/TEST Key.pem" \
  -L 5173:127.0.0.1:5173 \
  ubuntu@16.171.52.89
```

В браузере: http://127.0.0.1:5173/

Nginx на сервере: UI `127.0.0.1:5173`, `/api` проксируется на `127.0.0.1:8787`.

## Что крутится

| Сервис | Порт |
|---|---|
| `pm-assistant-api` | `127.0.0.1:8787` |
| `pm-assistant-worker` | без порта |
| nginx (UI) | `127.0.0.1:5173` |
| Docker-образ `pm-assistant-zoom-bot` | по запросу воркера |

Код: `/opt/pm-assistant/app`. База: `/var/lib/pm-assistant/app.sqlite`. Секреты: `/etc/pm-assistant.env` (права 600). Node 24: `/opt/node-24` (системный Node 22 для ArianaTent не меняли). Распознавание: `whisper-cli` + `libwhisper.so` в `/usr/local/lib` + модель `ggml-small.bin` (русский лучше tiny, без huge). Тексты сегментов в SQLite, таблица `transcript_segments`.

## Скрипты в этой папке

С Mac:

```bash
bash "Projects/PM Assistant/artifacts/deploy/sync.sh"
```

Перед копированием `sync.sh` дописывает секцию в `Projects/PM Assistant/CHANGELOG.md` для версии из `app/package.json`. На сервере копия: `/opt/pm-assistant/CHANGELOG.md`. Пропуск записи: `SKIP_RELEASE_NOTES=1`. Повтор той же версии без новых коммитов и файлов секцию не дублирует.

На сервере:

```bash
sudo bash /opt/pm-assistant/deploy/install-whisper.sh
bash /opt/pm-assistant/deploy/doctor.sh
bash /opt/pm-assistant/deploy/transcribe-meeting.sh <meeting-id>
```

`bootstrap.sh` вызывает `install-whisper.sh` целиком (бинарь + библиотеки), не копирует один `whisper-cli`. Повторная расшифровка уже сохранённого wav: `transcribe-meeting.sh`. HTTP: `POST /api/meetings/:id/transcribe`.

## Zoom Marketplace

В allowlist домена Meeting SDK добавить: `localhost` и `127.0.0.1` (бот открывает страницу SDK внутри контейнера на loopback). Прод-домена нет. Waiting room: пускать бота «PM Assistant» вручную.

## Перезапуск бота

На странице Настройки кнопка «Перезапустить бота» (диалог «Нужно ли перезапустить бота?»). `POST /api/bot/restart` снимает контейнеры Docker с меткой `pm-assistant.role=zoom-bot`, процессы `join.mjs`, зависшие встречи и задания, затем перезапускает `pm-assistant-worker`. Юнит воркера: `Restart=always`, чтобы после SIGTERM systemd поднял процесс снова. Процесс API (`pm-assistant-api`) не трогает. sudoers и отдельный helper не нужны: если `sudo -n systemctl` не проходит, достаточно `pkill` и `Restart=always`. После выкладки скопировать обновлённый `pm-assistant-worker.service` и `systemctl daemon-reload`.

## v2: Google OAuth и трекеры

Один `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` для входа и Google Календаря. Трекеры задач: Asana, Trello, ClickUp (по умолчанию в настройках), Notion. Переменные: `ASANA_PAT`, `TRELLO_API_KEY`, `CLICKUP_API_TOKEN`, `NOTION_API_KEY`. Подключение трекеров в UI этой версии: заглушки connect/disconnect, без живого OAuth.
