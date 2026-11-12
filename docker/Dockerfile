FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-inter \
    fonts-noto-core \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV VIDGEN_BROWSER_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENTRYPOINT ["node", "dist/cli/main.js"]
CMD ["--help"]
