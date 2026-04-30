FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json ./
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npm ci

COPY prisma ./prisma
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

COPY src/services ./src/services
COPY worker/sync-worker.ts ./sync-worker.ts
COPY tsconfig.json ./

CMD ["npx", "ts-node", "--skip-project", "sync-worker.ts"]
