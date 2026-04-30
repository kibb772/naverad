FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

# 루트 패키지 설치 (prisma 포함)
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src/services ./src/services
COPY worker/sync-worker.ts ./sync-worker.ts
COPY tsconfig.json ./

ENV DATABASE_URL=""

CMD ["npx", "ts-node", "--skip-project", "sync-worker.ts"]
