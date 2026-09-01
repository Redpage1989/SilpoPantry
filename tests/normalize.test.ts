import { describe, it, expect } from 'vitest'
import { normalizeProductName, guessCategory, isSameIngredient, defaultUnit, canonicalKeys } from '@/lib/domain/normalize'

describe('normalizeProductName', () => {
  it('зводить бренд, відсоток і вагу з чека до чистого ключа', () => {
    expect(normalizeProductName('Молоко «Селянське» ультрапастеризоване 2,5% 900 мл')).toBe('молоко')
    expect(normalizeProductName('Яйця курячі С1, 10 шт')).toBe('яйця')
    expect(normalizeProductName('Масло вершкове Селянське 72,6% 200 г')).toBe('масло вершкове')
  })

  it('зводить відмінкові форми до однієї основи', () => {
    expect(normalizeProductName('молока')).toBe('молоко')
    expect(normalizeProductName('Молоко')).toBe('молоко')
    expect(normalizeProductName('цукру')).toBe('цукор')
    expect(normalizeProductName('борошна')).toBe('борошно')
  })

  it('обʼєднує синоніми та транслітерації', () => {
    expect(normalizeProductName('Mascarpone')).toBe('маскарпоне')
    expect(normalizeProductName('Сир Маскарпоне')).toBe('маскарпоне')
    expect(normalizeProductName('спагетті')).toBe('макарони')
    expect(normalizeProductName('Печиво Савоярді')).toBe('савоярді')
    expect(normalizeProductName('дамські пальчики')).toBe('савоярді')
    expect(normalizeProductName('Томати')).toBe('помідори')
    expect(normalizeProductName('Помідор')).toBe('помідори')
  })

  it('не плутає різні продукти з однаковим префіксом', () => {
    expect(normalizeProductName('Сир твердий Голландський')).toBe('сир твердий')
    expect(normalizeProductName('Сир кисломолочний 9%')).toBe('сир кисломолочний')
    expect(normalizeProductName('Сир твердий')).not.toBe(normalizeProductName('Сир кисломолочний'))
  })

  it('повертає порожній рядок для порожнього вводу', () => {
    expect(normalizeProductName('')).toBe('')
    expect(normalizeProductName('   ')).toBe('')
  })

  it('не падає на назві з самих цифр і символів', () => {
    expect(() => normalizeProductName('2,5% 900 мл')).not.toThrow()
  })
})

/**
 * Латиниця з етикеток імпортних товарів. Живі позиції каталогу:
 * «Сир Mascarpone Galbani», «Печиво Savoiardi Vicenzi», «Savoiardi Bonomi,
 * ящик 6 × 400 г». Без транслітерації такий товар отримував ключ «сир»,
 * «печиво» чи «savoiardi» — і випадав із матчингу за кириличним ключем.
 */
describe('латинські терміни з етикеток зводяться до кириличного ключа', () => {
  it('латинський термін у назві дає той самий ключ, що кириличний', () => {
    expect(normalizeProductName('Сир Mascarpone Galbani, 250 г')).toBe('маскарпоне')
    expect(normalizeProductName('Печиво Savoiardi Vicenzi, 200 г')).toBe('савоярді')
    expect(normalizeProductName('Savoiardi Bonomi, ящик 6 × 400 г')).toBe('савоярді')
    expect(normalizeProductName('Mozzarella Galbani у розсолі')).toBe('моцарела')
    expect(normalizeProductName('Parmigiano Reggiano витриманий')).toBe('пармезан')
    expect(normalizeProductName('Ricotta Dolce')).toBe('рикота')
  })

  it('транслітерований термін іде далі конвеєром синонімів, а не підміняє його', () => {
    // spaghetti → спагеті → макарони: словник дає кирилицю, канонізує конвеєр
    expect(normalizeProductName('Spaghetti Barilla')).toBe('макарони')
    expect(normalizeProductName('Cocoa Powder')).toBe('какао')
  })

  it('латинський бренд без харчового терміна ключем не стає', () => {
    expect(normalizeProductName('Kinder Surprise яйце')).not.toBe('яйця')
    expect(normalizeProductName('Galbani')).toBe('galbani')
  })
})

describe('isSameIngredient', () => {
  it('визнає збіг через список замін', () => {
    expect(isSameIngredient('вершки', 'сметана', ['сметана'])).toBe(true)
    expect(isSameIngredient('вершки', 'сметана')).toBe(false)
  })
})

describe('guessCategory', () => {
  it('визначає категорію, місце зберігання і типовий строк придатності', () => {
    expect(guessCategory('Молоко 2,5%')).toMatchObject({ category: 'Молочні продукти', storageLocation: 'fridge' })
    expect(guessCategory('Шпинат').storageLocation).toBe('produce')
    expect(guessCategory('Макарони').storageLocation).toBe('pantry')
    expect(guessCategory('Кава мелена').storageLocation).toBe('drinks')
  })

  it('має розумний fallback для невідомого товару', () => {
    const g = guessCategory('Щось геть незрозуміле')
    expect(g.category).toBe('Інше')
    expect(g.shelfLifeDays).toBeGreaterThan(0)
  })

  it('дає коротший строк придатності для швидкопсувних', () => {
    expect(guessCategory('Шпинат').shelfLifeDays).toBeLessThan(guessCategory('Макарони').shelfLifeDays)
  })
})

describe('defaultUnit', () => {
  it('яйця рахуються штуками, молоко — мілілітрами', () => {
    expect(defaultUnit('Яйця курячі')).toBe('шт')
    expect(defaultUnit('Молоко')).toBe('мл')
    expect(defaultUnit('Шпинат')).toBe('г')
  })
})

describe('канонічні ключі стабільні за побудовою', () => {
  it('КОЖЕН канонічний ключ нормалізується сам у себе', () => {
    // Саме цей інваріант тричі порушувався мовчки — на «масло вершкове»,
    // «соєвий соус» і «томатна паста». Тепер identity-записи генеруються,
    // а тест покриває весь набір, а не лише ключі з книги рецептів.
    const broken = canonicalKeys().filter((key) => normalizeProductName(key) !== key)
    expect(broken, `ключі, що не нормалізуються самі в себе:\n${broken.join('\n')}`).toEqual([])
  })

  it('багатослівні ключі не обрізаються до першого слова', () => {
    const multiword = canonicalKeys().filter((k) => k.includes(' '))
    expect(multiword.length).toBeGreaterThan(3)
    for (const key of multiword) {
      expect(normalizeProductName(key), `«${key}» обрізався`).toBe(key)
    }
  })

  it('новий багатослівний ключ у CATEGORY_MAP працює без ручного запису', () => {
    // «томатна паста» додавалась лише в CATEGORY_MAP — identity згенеровано
    expect(canonicalKeys()).toContain('томатна паста')
    expect(normalizeProductName('Томатна паста')).toBe('томатна паста')
    expect(normalizeProductName('Паста томатна')).toBe('томатна паста')
  })
})
