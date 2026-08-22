import { prisma } from '@/lib/db'
import { isoWeek } from '@/lib/domain/user-recipes'
import { buildAwardRequest, resolveTie } from '@/lib/domain/weekly-award'
import { logEvent } from '@/lib/mcp/pii'

/**
 * Закриття тижнів голосування.
 *
 * Викликається під час читання стрічки, а не за розкладом. Причина та сама,
 * що й для TTL фото: окремий планувальник у прототипі — це ще один механізм,
 * який може тихо зупинитись, і ніхто про це не дізнається. Тут же підрахунок
 * стається рівно тоді, коли результат комусь потрібен.
 *
 * Ідемпотентність тримає база: `isoWeek` унікальний, тож паралельні читання
 * не створять двох переможців того самого тижня.
 */
export async function closeFinishedWeeks(now: Date): Promise<number> {
  const current = isoWeek(now)

  /**
   * Дешевий вихід для стабільного стану.
   *
   * Виклик стоїть на читанні стрічки, а findMany з distinct нижче Prisma
   * виконує В ПАМ'ЯТІ — тобто тягне всі не-поточні голоси при кожному GET,
   * і ця купа росте назавжди. Якщо минулий тиждень уже закритий — закривати
   * нічого: голосувати можна лише за поточний, тож нових «відкритих» минулих
   * тижнів між двома читаннями з'явитись не може.
   */
  const previous = isoWeek(new Date(now.getTime() - 7 * 86_400_000))
  const prevClosed = await prisma.weeklyAward.findUnique({ where: { isoWeek: previous } })
  if (prevClosed) return 0

  const weeks = await prisma.recipeVote.findMany({
    where: { isoWeek: { not: current } },
    distinct: ['isoWeek'],
    select: { isoWeek: true },
  })
  if (weeks.length === 0) return 0

  const closed = await prisma.weeklyAward.findMany({
    where: { isoWeek: { in: weeks.map((w) => w.isoWeek) } },
    select: { isoWeek: true },
  })
  const done = new Set(closed.map((a) => a.isoWeek))
  const pending = weeks.map((w) => w.isoWeek).filter((w) => !done.has(w))

  let created = 0
  for (const week of pending) {
    const tally = await prisma.recipeVote.groupBy({
      by: ['userRecipeId'],
      where: { isoWeek: week },
      _count: { userRecipeId: true },
    })
    if (tally.length === 0) continue

    const recipes = await prisma.userRecipe.findMany({
      where: { id: { in: tally.map((t) => t.userRecipeId) } },
      select: { id: true, authorId: true, createdAt: true },
    })
    const meta = new Map(recipes.map((r) => [r.id, r]))

    const winner = resolveTie(
      tally
        .map((t) => {
          const m = meta.get(t.userRecipeId)
          return m
            ? {
                recipeId: t.userRecipeId,
                authorId: m.authorId,
                votes: t._count.userRecipeId,
                createdAt: m.createdAt,
              }
            : null
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    )
    if (!winner) continue

    const outcome = buildAwardRequest(
      { isoWeek: week, userRecipeId: winner.recipeId, authorId: winner.authorId, votes: winner.votes },
      now,
    )
    if (!outcome.request) continue

    try {
      await prisma.weeklyAward.create({
        data: {
          isoWeek: outcome.request.isoWeek,
          userRecipeId: outcome.request.userRecipeId,
          authorId: outcome.request.authorId,
          votes: outcome.request.votes,
          prizeBalabonuses: outcome.request.prizeBalabonuses,
          status: outcome.request.status,
        },
      })
      created += 1
      logEvent('info', 'weekly_award.created', { week, votes: winner.votes })
    } catch {
      // унікальність isoWeek — інший запит устиг раніше, це нормально
    }
  }

  return created
}
