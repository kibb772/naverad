FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json ./
# postinstall(prisma generate) 스킵하고 설치
RUN npm ci --ignore-scripts

COPY prisma ./prisma
# 더미 URL로 prisma generate 실행
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

COPY src/services ./src/services
COPY worker/sync-worker.ts ./sync-worker.ts
COPY tsconfig.json ./

CMD ["npx", "ts-node", "--skip-project", "sync-worker.ts"]
