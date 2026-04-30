FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

# 환경변수 미리 설정해서 prisma generate 성공하게
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src/services ./src/services
COPY worker/sync-worker.ts ./sync-worker.ts
COPY tsconfig.json ./

CMD ["npx", "ts-node", "--skip-project", "sync-worker.ts"]
