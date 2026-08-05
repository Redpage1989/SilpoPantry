import { PrismaClient } from '@prisma/client'
import { seedRecipes, seedDemoUser } from '../src/lib/seed/demo'

/**
 * Seed для demo mode. Уся логіка живе в src/lib/seed/demo.ts,
 * щоб той самий код використовував і dev-ендпойнт скидання для E2E.
 */
const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Наповнюю demo-дані…')
  const recipes = await seedRecipes(prisma)
  console.log(`   ✓ рецептів: ${recipes}`)
  const demo = await seedDemoUser(prisma)
  console.log(`   ✓ родина: ${demo.members} особи, обмежень: ${demo.restrictions}`)
  console.log(`   ✓ комора: ${demo.pantry} позицій (шпинат — «використати сьогодні»)`)
  console.log('✅ Готово. Demo mode доступний одразу після запуску.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
