FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

# 워커 전용 package.json 사용 (postinstall 없음)
COPY worker/package.json ./package.json
RUN npm install

COPY prisma ./prisma
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

COPY src/services ./src/services
COPY worker/sync-worker.ts ./sync-worker.ts
COPY tsconfig.json ./

CMD ["npm", "start"]
