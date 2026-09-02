import type { PrismaClient } from '@prisma/client'
import { checkComposition, slugifyTitle, isoWeek } from '@/lib/domain/user-recipes'

/**
 * Стартовий вміст стрічки спільноти.
 *
 * Порожня стрічка читається як зламаний розділ, а не як «ще ніхто не додав»:
 * людина, яка вперше відкриває демо, бачить заголовок «Страви від інших
 * родин» і нічого під ним. Те саме, що було з порожньою коморою.
 *
 * Автори — вигадані, як і решта демо-даних. Це прямо сказано в підписі під
 * стрічкою; видавати їх за реальних користувачів не можна.
 *
 * Інгредієнти навмисно взяті з канонічного словника (`normalize.ts`): лише
 * тоді `compositionVerified` стає true, і агент може брати ці страви в
 * підбір. Рецепт із невпізнаним складом ліг би у стрічку з попередженням —
 * чесно, але для першого враження це виглядало б як недоробка.
 */

interface SeedAuthor {
  id: string
  displayName: string
}

const AUTHORS: SeedAuthor[] = [
  { id: 'demo-author-mariia', displayName: 'Марія' },
  { id: 'demo-author-ihor', displayName: 'Ігор' },
  { id: 'demo-author-olena', displayName: 'Олена' },
  { id: 'demo-author-natalia', displayName: 'Наталя' },
]

interface SeedRecipe {
  authorId: string
  title: string
  summary: string
  servings: number
  cookingTime: number
  difficulty: 'easy' | 'medium' | 'hard'
  cuisine: string
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'dessert' | 'snack'
  imageEmoji: string
  ingredients: { name: string; quantity: number; unit: 'г' | 'кг' | 'мл' | 'л' | 'шт' | 'ст.л' | 'ч.л' }[]
  steps: { text: string; timerMinutes?: number }[]
  tips: { kind: 'technique' | 'substitute' | 'storage' | 'safety' | 'kids'; text: string }[]
  declaredAllergens: string[]
  /** хто проголосував за цей рецепт цього тижня */
  votedBy: string[]
}

/** Експортовано для тесту: склад має розпізнаватись, інакше агент не візьме страву в підбір. */
export const COMMUNITY_RECIPES: SeedRecipe[] = [
  {
    authorId: 'demo-author-mariia',
    title: 'Деруни з кабачків',
    summary: 'Коли кабачків більше, ніж ідей. Смажаться швидше за картопляні й не темніють.',
    servings: 4,
    cookingTime: 30,
    difficulty: 'easy',
    cuisine: 'Українська',
    mealType: 'lunch',
    imageEmoji: '🥒',
    ingredients: [
      { name: 'Кабачки', quantity: 600, unit: 'г' },
      { name: 'Яйця', quantity: 2, unit: 'шт' },
      { name: 'Борошно', quantity: 80, unit: 'г' },
      { name: 'Цибуля', quantity: 1, unit: 'шт' },
      { name: 'Олія', quantity: 3, unit: 'ст.л' },
      { name: 'Сметана', quantity: 100, unit: 'г' },
    ],
    steps: [
      { text: 'Кабачки натріть на великій тертці, посоліть і лишіть на десять хвилин.', timerMinutes: 10 },
      { text: 'Відіжміть рідину руками — це головне, інакше тісто попливе.' },
      { text: 'Додайте яйця, борошно й дрібно нарізану цибулю, перемішайте.' },
      { text: 'Смажте на олії по три хвилини з кожного боку до золотої скоринки.', timerMinutes: 6 },
    ],
    tips: [
      { kind: 'technique', text: 'Рідину з кабачків не виливайте одразу: якщо тісто вийшло густим, ложка цієї ж рідини рятує краще за воду.' },
      { kind: 'kids', text: 'Дітям смажу дрібніші — вони швидше прожарюються всередині й не лишаються сируватими.' },
    ],
    declaredAllergens: ['яйця', 'глютен', 'лактоза'],
    votedBy: ['demo-author-ihor', 'demo-author-olena', 'demo-author-natalia'],
  },
  {
    authorId: 'demo-author-ihor',
    title: 'Гречка з грибами по-домашньому',
    summary: 'Одна сковорідка, двадцять хвилин і жодного соусу з пакетика.',
    servings: 3,
    cookingTime: 25,
    difficulty: 'easy',
    cuisine: 'Українська',
    mealType: 'dinner',
    imageEmoji: '🍄',
    ingredients: [
      { name: 'Гречка', quantity: 250, unit: 'г' },
      { name: 'Гриби', quantity: 300, unit: 'г' },
      { name: 'Цибуля', quantity: 1, unit: 'шт' },
      { name: 'Масло вершкове', quantity: 30, unit: 'г' },
      { name: 'Олія', quantity: 2, unit: 'ст.л' },
    ],
    steps: [
      { text: 'Гречку залийте окропом у пропорції один до двох і варіть під кришкою.', timerMinutes: 15 },
      { text: 'Гриби наріжте пластинами й викладайте на суху розігріту сковорідку — спершу вийде вода.' },
      { text: 'Коли вода випарується, додайте олію та цибулю й смажте до золотого.', timerMinutes: 7 },
      { text: 'Змішайте з гречкою, додайте вершкове масло й накрийте на дві хвилини.', timerMinutes: 2 },
    ],
    tips: [
      { kind: 'technique', text: 'Гриби на суху сковорідку, а не в олію: інакше вони варяться у власній воді й лишаються гумовими.' },
      { kind: 'substitute', text: 'Замість вершкового масла підійде ложка сметани — смак м’якший, але олії вже не треба.' },
    ],
    declaredAllergens: ['лактоза'],
    votedBy: ['demo-author-mariia', 'demo-author-natalia'],
  },
  {
    authorId: 'demo-author-olena',
    title: 'Сирники з родзинками',
    summary: 'Сніданок на двадцять хвилин із того, що майже завжди є в холодильнику.',
    servings: 2,
    cookingTime: 20,
    difficulty: 'easy',
    cuisine: 'Українська',
    mealType: 'breakfast',
    imageEmoji: '🥞',
    ingredients: [
      { name: 'Сир кисломолочний', quantity: 400, unit: 'г' },
      { name: 'Яйця', quantity: 1, unit: 'шт' },
      { name: 'Борошно', quantity: 60, unit: 'г' },
      { name: 'Цукор', quantity: 2, unit: 'ст.л' },
      { name: 'Родзинки', quantity: 50, unit: 'г' },
      { name: 'Олія', quantity: 2, unit: 'ст.л' },
    ],
    steps: [
      { text: 'Родзинки залийте окропом на п’ять хвилин і відкиньте на сито.', timerMinutes: 5 },
      { text: 'Сир розімніть виделкою з яйцем і цукром, додайте борошно й родзинки.' },
      { text: 'Сформуйте кружальця завтовшки в палець і обваляйте в борошні.' },
      { text: 'Смажте на невеликому вогні під кришкою по чотири хвилини з боку.', timerMinutes: 8 },
    ],
    tips: [
      { kind: 'technique', text: 'Під кришкою сирники прогріваються всередині й не лишаються сирими — без цього доводиться пересмажувати шкоринку.' },
      { kind: 'storage', text: 'Тісто краще не готувати заздалегідь: постоявши, воно пускає воду й потребує ще борошна.' },
    ],
    declaredAllergens: ['яйця', 'глютен', 'молочний білок'],
    votedBy: ['demo-author-mariia', 'demo-author-ihor'],
  },
]

/**
 * Наповнює стрічку, якщо вона порожня. Ідемпотентна: авторів створює
 * upsert-ом, рецепти — лише за відсутності свого slug, голоси — за
 * унікальним ключем (рецепт, виборець, тиждень).
 *
 * Голоси ставлять тільки вигадані автори. Демо-користувач свій голос не
 * витрачає: інакше людина, яка відкриє демо, побачить кнопку голосування вже
 * натиснутою — і не зможе спробувати єдину дію, заради якої цей розділ є.
 */
export async function seedCommunity(prisma: PrismaClient, now = new Date()) {
  for (const a of AUTHORS) {
    await prisma.user.upsert({
      where: { id: a.id },
      update: {},
      create: { id: a.id, displayName: a.displayName, authMode: 'demo', onboardedAt: now },
    })
  }

  const week = isoWeek(now)
  let created = 0
  let votes = 0

  for (const r of COMMUNITY_RECIPES) {
    const slug = slugifyTitle(r.title)
    const existing = await prisma.userRecipe.findUnique({ where: { slug } })
    const composition = checkComposition(r.ingredients)
    const recipe =
      existing ??
      (await prisma.userRecipe.create({
        data: {
          authorId: r.authorId,
          slug,
          title: r.title,
          summary: r.summary,
          servings: r.servings,
          cookingTime: r.cookingTime,
          difficulty: r.difficulty,
          cuisine: r.cuisine,
          mealType: r.mealType,
          imageEmoji: r.imageEmoji,
          ingredients: JSON.stringify(composition.ingredients),
          steps: JSON.stringify(r.steps.map((s, i) => ({ step: i + 1, ...s }))),
          tips: JSON.stringify(r.tips),
          declaredAllergens: JSON.stringify(r.declaredAllergens),
          compositionVerified: composition.verified,
          unknownIngredients: JSON.stringify(composition.unknown),
          status: 'published',
        },
      }))
    if (!existing) created += 1

    for (const voterId of r.votedBy) {
      const already = await prisma.recipeVote.findFirst({
        where: { userRecipeId: recipe.id, voterId, isoWeek: week },
      })
      if (already) continue
      await prisma.recipeVote.create({ data: { userRecipeId: recipe.id, voterId, isoWeek: week } })
      votes += 1
    }
  }

  return { authors: AUTHORS.length, recipes: created, votes }
}
