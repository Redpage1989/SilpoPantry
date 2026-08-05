// Один schema.prisma для SQLite (локально) і PostgreSQL (prod).
// Prisma не дозволяє env() у полі provider, тому перемикаємо рядок явно.
import { readFileSync, writeFileSync } from 'node:fs'

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite'
if (!['sqlite', 'postgresql'].includes(provider)) {
  console.error(`DATABASE_PROVIDER має бути "sqlite" або "postgresql", отримано: ${provider}`)
  process.exit(1)
}
const path = new URL('../prisma/schema.prisma', import.meta.url)
const src = readFileSync(path, 'utf8')
const next = src.replace(/provider = "(sqlite|postgresql)"/, `provider = "${provider}"`)
if (next !== src) writeFileSync(path, next)
console.log(`prisma datasource provider = ${provider}`)
