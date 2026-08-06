# Збірка «Сільпо: Сімейна комора» для сервера.
#
# Debian-slim, а не alpine: Prisma під musl потребує окремих бінарників
# движка, і кожне оновлення версії — новий привід зламати збірку.
# Кілька зайвих мегабайт образу того не варті.

FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Значення тут не потрапляють у рантайм: під час збірки БД не читається,
# але Prisma вимагає, щоб змінна взагалі існувала.
ENV DATABASE_URL="file:/data/prod.db"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx tsx scripts/export-recipes.ts && npm run build

FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# standalone містить лише те, що справді потрібно для запуску
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma: схема + повний node_modules.
#
# Вибіркове копіювання @prisma/* і prisma/ виглядало ощадливіше, але CLI
# тягне транзитивні залежності, і контейнер падав з MODULE_NOT_FOUND уже
# на `db push`. Ганятися за списком пакетів заради ~300 МБ образу —
# погана угода: тут важливіше, щоб деплой просто працював.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
