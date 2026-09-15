# Бот Яндекс.Телемоста: заходит в звонок гостем по ссылке и пишет звук в webm/opus.
# Контекст сборки: каталог app/bot, потому что перехват звука общий и лежит в bot/common.
# Собирать из каталога app: npm run bot:build:telemost.
#
# Раскладка в образе повторяет репозиторий: /bot/common (оба файла перехвата
# в одном каталоге, audio-sink.mjs ищет capture-audio.js рядом с собой) и
# /bot/telemost-web (скрипт входа и его node_modules).
#
# ffmpeg в образ не ставится намеренно: без него звук остаётся webm/opus,
# конвейер ждёт именно data/audio/<id>.webm.
FROM mcr.microsoft.com/playwright:v1.55.0-jammy
LABEL pm-assistant.role=telemost-bot
WORKDIR /bot/telemost-web
COPY telemost-web/package.json telemost-web/package-lock.json ./
RUN npm ci --omit=dev \
  && node -e "const v=require('playwright/package.json').version; if(!String(v).startsWith('1.55.')){console.error('playwright',v); process.exit(1)}"
COPY common/capture-audio.js common/audio-sink.mjs /bot/common/
COPY telemost-web/join.mjs telemost-web/telemost-state.mjs ./
ENV TELEMOST_BOT_HEADLESS=1
CMD ["node", "join.mjs"]
