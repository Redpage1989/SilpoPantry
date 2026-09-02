import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { setSession } from '@/lib/session'
import { errorResponse } from '@/lib/api'
import { logEvent } from '@/lib/mcp/pii'
import { resetDemoCart } from '@/lib/mcp/mock-adapter'
import { seedDemoUser, seedRecipes, DEMO_USER_ID } from '@/lib/seed/demo'
import { seedCommunity } from '@/lib/seed/community'

/**
 * Запуск demo-режиму. Створює (або перевикористовує) демонстраційного
 * користувача з seed-даними. Жодних персональних даних не збирає.
 *
 * Комора наповнюється саме тут, а не лише в `db:seed` і dev-скиданні.
 * На проді `/api/dev/reset` вимкнено назавжди (404), тож демо-користувач
 * лишався з порожньою коморою: людина натискала «Спробувати в
 * демонстраційному режимі» й бачила «Комора ще порожня» і страви по 0 % —
 * тобто спростування головної тези продукту на першому ж екрані.
 *
 * Умова — саме порожня комора, а не кожен вхід. Демо-користувач один на всіх,
 * і безумовне перезаповнення скидало б стан тому, хто вже щось у демо робить.
 */
export async function POST() {
  try {
    const pantrySize = await prisma.pantryItem.count({ where: { userId: DEMO_USER_ID } })
    if (pantrySize === 0) {
      await seedRecipes(prisma)
      await seedDemoUser(prisma, DEMO_USER_ID)
      // Кошик живе окремою таблицею й переживає скидання комори. Без цього
      // свіжа комора дісталась би разом із позиціями від попереднього показу.
      await resetDemoCart(DEMO_USER_ID)
      logEvent('info', 'auth.demo_seeded', {})
    }

    /**
     * Стрічка спільноти сіється окремою умовою, а не разом із коморою:
     * рецепти інших родин переживають скидання комори, і прив'язувати їх
     * до неї означало б втрачати їх щоразу, коли хтось спорожнив полиці.
     */
    if ((await prisma.userRecipe.count()) === 0) {
      await seedCommunity(prisma)
      logEvent('info', 'community.seeded', {})
    }

    /**
     * Створення лишається запобіжником: сюди доходимо, лише якщо комора не
     * порожня, тобто користувач уже існує. `update` порожній навмисно —
     * налаштування, змінені під час показу, затирати не треба.
     */
    const user = await prisma.user.upsert({
      where: { id: DEMO_USER_ID },
      update: {},
      create: {
        id: DEMO_USER_ID,
        displayName: 'Антон',
        authMode: 'demo',
        weeklyBudget: 2_000_00,
        mealsPerDay: 3,
        maxCookMinutes: 40,
        onboardedAt: new Date(),
      },
    })
    await setSession(user.id)
    logEvent('info', 'auth.demo_started', {})
    return NextResponse.json({ ok: true, mode: 'demo', displayName: user.displayName })
  } catch (err) {
    return errorResponse(err)
  }
}
