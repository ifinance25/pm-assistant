# Контейнер Google Meet. Контекст сборки: каталог app/bot, собирать через
# npm run bot:build:meet. Перехват звука общий: audio-sink.mjs ищет
# capture-audio.js в своём каталоге, поэтому оба файла кладутся рядом с join.mjs.
FROM mcr.microsoft.com/playwright:v1.55.0-jammy
LABEL pm-assistant.role=meet-bot
WORKDIR /bot
COPY meet-web/package.json meet-web/package-lock.json ./
RUN npm ci --omit=dev \
  && node -e "const v=require('playwright/package.json').version; if(!String(v).startsWith('1.55.')){console.error('playwright',v); process.exit(1)}"
COPY common/audio-sink.mjs common/capture-audio.js ./
COPY meet-web/join.mjs meet-web/meet-state.mjs ./
ENV MEET_BOT_HEADLESS=1
ENV MEET_BOT_CHANNEL=
CMD ["node", "join.mjs"]
