#!/bin/sh
# Старт контейнера: привести БД у відповідність схемі, наповнити довідники,
# потім підняти сервер.
#
# `db push`, а не `migrate deploy`: у прототипі немає історії міграцій,
# а схема — єдине джерело правди. Для продукту це треба замінити на
# повноцінні міграції; у README це сказано прямо.
set -e

echo "[entrypoint] синхронізую схему БД…"
./node_modules/.bin/prisma db push --skip-generate --accept-data-loss

echo "[entrypoint] наповнюю книгу рецептів…"
node -e '
const { PrismaClient } = require("@prisma/client");
const rows = require("./prisma/recipes.json");
const prisma = new PrismaClient();
(async () => {
  // upsert, а не createMany: перезапуск контейнера не має дублювати рецепти
  for (const r of rows) {
    await prisma.recipe.upsert({ where: { slug: r.slug }, update: r, create: r });
  }
  console.log("[entrypoint] рецептів у базі: " + (await prisma.recipe.count()));
  await prisma.$disconnect();
})().catch((e) => { console.error("[entrypoint] seed:", e.message); process.exit(1) });
'

echo "[entrypoint] стартую Next.js на :${PORT:-3000}"
exec node server.js
