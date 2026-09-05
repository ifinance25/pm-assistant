FROM mcr.microsoft.com/playwright:v1.55.0-jammy
WORKDIR /bot
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && node -e "const v=require('playwright/package.json').version; if(!String(v).startsWith('1.55.')){console.error('playwright',v); process.exit(1)}"
COPY join.mjs capture-audio.js ./
COPY public ./public
ENV ZOOM_BOT_HEADLESS=1
ENV ZOOM_BOT_CHANNEL=
CMD ["node", "join.mjs"]
