FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
RUN SKIP_POSTINSTALL=1 npm ci

# Rebuild the source code only when needed
FROM base AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npm run build

# Production image
FROM base AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/pdfkit ./node_modules/pdfkit
COPY --from=builder /app/node_modules/fontkit ./node_modules/fontkit
COPY --from=builder /app/node_modules/linebreak ./node_modules/linebreak
COPY --from=builder /app/node_modules/png-js ./node_modules/png-js
COPY --from=builder /app/node_modules/js-md5 ./node_modules/js-md5
COPY --from=builder /app/node_modules/@noble ./node_modules/@noble
COPY --from=builder /app/node_modules/dfa ./node_modules/dfa
COPY --from=builder /app/node_modules/unicode-trie ./node_modules/unicode-trie
COPY --from=builder /app/node_modules/unicode-properties ./node_modules/unicode-properties
COPY --from=builder /app/node_modules/restructure ./node_modules/restructure
COPY --from=builder /app/node_modules/brotli ./node_modules/brotli
COPY --from=builder /app/node_modules/clone ./node_modules/clone
COPY --from=builder /app/node_modules/deep-equal ./node_modules/deep-equal
COPY --from=builder /app/node_modules/tiny-inflate ./node_modules/tiny-inflate

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
