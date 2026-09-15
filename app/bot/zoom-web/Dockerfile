# Контекст сборки — каталог app/bot, а не app/bot/zoom-web: перехват звука
# общий для всех платформ и лежит в bot/common. Собирать через npm run bot:build:zoom.
FROM mcr.microsoft.com/playwright:v1.55.0-jammy
WORKDIR /bot
COPY zoom-web/package.json zoom-web/package-lock.json ./
RUN npm ci --omit=dev \
  && node -e "const v=require('playwright/package.json').version; if(!String(v).startsWith('1.55.')){console.error('playwright',v); process.exit(1)}"
COPY zoom-web/join.mjs zoom-web/speaker-sdk.js ./
COPY common/capture-audio.js ./
COPY zoom-web/public ./public
ENV ZOOM_BOT_HEADLESS=1
ENV ZOOM_BOT_CHANNEL=
CMD ["node", "join.mjs"]
