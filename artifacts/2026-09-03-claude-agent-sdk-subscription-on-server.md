# Claude Agent SDK на сервере: подписка, не ключ API

**Дата:** 2026-09-03  
**Зачем:** процесс приложения (воркер, Agent SDK) ходит в Claude с места Pro/Max/Team, без счёта Console (`sk-ant-…`).  
**Шаблон переменных:** [`.env.example`](../.env.example)  
**Источники:** [аутентификация Claude Code](https://code.claude.com/docs/en/authentication), [quickstart Agent SDK](https://code.claude.com/docs/en/agent-sdk/quickstart), [хостинг SDK](https://code.claude.com/docs/en/agent-sdk/hosting), [справка: SDK и план Claude](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

Личное приложение. Один человек, одно место подписки. Общий шлюз «все пользователи на одном месте» так делать нельзя.

С 15.06.2026 отдельный месячный кредит Agent SDK на паузе. Вызовы SDK и `claude -p` едят лимит подписки, как интерактивный Claude Code. Счёта API при этом нет, если ключ Console не задан.

---

## Что должно быть заранее

- План Pro, Max, Team или Enterprise.
- Токен выпускаете на своём Mac с браузером, не на headless-сервере.
- На сервере крутится ваш процесс. Пользователи продукта не входят в ваш claude.ai.

---

## 1. Выпустить токен на Mac

```bash
claude setup-token
```

Откроется браузер, как при `/login`. После согласия токен печатается в терминал и никуда не сохраняется. Скопировать сразу.

Срок: около года. Токен умеет только запросы к модели: без Remote Control и без коннекторов claude.ai. Локальные MCP на сервере работают.

Не копировать на VPS связку из Keychain и файл `~/.claude/.credentials.json` с Mac. На Linux это часто ломается. Нужен именно `setup-token`.

---

## 2. Положить токен только в окружение сервера

Не в git, не в образ Docker, не в `settings.json` репозитория.

Пример (права `600`, владелец процесса приложения):

```bash
# /etc/pm-assistant.env
CLAUDE_CODE_OAUTH_TOKEN=скопированный-токен
```

В этом окружении нет `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN`. Если ключ API задан, Claude игнорирует подписку и идёт в Console.

Не ставить флаги облака: `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`.

systemd:

```ini
[Service]
EnvironmentFile=/etc/pm-assistant.env
```

Docker Compose:

```yaml
services:
  app:
    env_file:
      - /etc/pm-assistant.env
```

Проверка, что ключ API не просочился:

```bash
sudo -u имя-сервиса printenv | grep -E 'ANTHROPIC|CLAUDE_CODE_OAUTH'
```

Должно быть: есть `CLAUDE_CODE_OAUTH_TOKEN`, нет `ANTHROPIC_API_KEY`.

Локально: скопировать `.env.example` в `.env` и вставить токен. `.env` уже в `.gitignore`.

---

## 3. Приложение читает токен само

SDK поднимает дочерний процесс `claude` и забирает переменные из окружения.

Python (поле `env` добавляется к окружению процесса; ключ API у родителя останется, если он уже есть):

```python
import os
from claude_agent_sdk import ClaudeAgentOptions, query

assert os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"), "нет OAuth-токена"
assert not os.environ.get("ANTHROPIC_API_KEY"), "ключ API перебьёт подписку"

options = ClaudeAgentOptions(
    cwd="/var/lib/pm-assistant",
    setting_sources=["project"],  # или [] чтобы не тянуть ~/.claude с сервера
    permission_mode="acceptEdits",
)
```

TypeScript: `options.env` подменяет окружение целиком. Нужно явно протащить `PATH` и токен, ключ API не копировать:

```ts
const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
```

Пакеты: `claude-agent-sdk` (Python) или `@anthropic-ai/claude-agent-sdk` (TypeScript). В колёсах/npm обычно уже лежит бинарник Claude Code.

---

## 4. Проверить, что это подписка, не API

На сервере, тем же пользователем, что и приложение:

```bash
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
export CLAUDE_CODE_OAUTH_TOKEN='…'

claude -p "Ответь одним словом: ok" --output-format json
```

Успешный ответ без ошибки про API-ключ значит, что канал живой.

На Mac в интерактивном Claude Code: `/status`. Строка входа: аккаунт с подпиской. Строки API key быть не должно.

Расход смотреть в лимитах плана на claude.ai, не в биллинге Console. Если в Console появилась активность по ключу `sk-ant-…`, на сервере всё ещё торчит `ANTHROPIC_API_KEY`.

---

## 5. Типичные поломки

| Симптом | Что сделать |
|---|---|
| Списания в Console | Найти и убрать `ANTHROPIC_API_KEY` у systemd, Docker, `.bashrc` сервиса, блока `env` в `~/.claude/settings.json` |
| `Not logged in` / нет метода входа | Токен не попал в процесс SDK (другой user, Docker без `env_file`) |
| Лимит подписки кончился днём | Сервер ест то же место, что и Claude Code на ноутбуке; круглосуточный агент сажает Max/Pro быстро |
| После деплоя чужие скиллы и память | Не копировать весь домашний `~/.claude`; задать `setting_sources=[]` или только `"project"`, при необходимости `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` |

Токен скомпрометирован: выпустить новый `claude setup-token`, заменить на сервере, перезапустить сервис. Старый из репозитория считать украденным.

---

## 6. Чего этот путь не делает

- Не обнуляет расход: токены модели считаются с лимита подписки, не со счёта API.
- Не подходит как шлюз для команды или клиентов: одно место, один человек.
- Для чужого продакшена «нажал кнопку, ответило всем» Anthropic указывает ключ Console.

Порядок учёток (сверху вниз): облачный провайдер → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → профиль Console → OAuth от `/login`.
