/**
 * Нові слайди пітчу v7 (відгук журі 28.09): проблема з даними, гіпотеза,
 * для кого й рішення, чесний пілот. Стиль той самий, що в build-pitch.ts.
 *
 * Джерело цифр проблеми: UNEP, Food Waste Index Report 2024 — домогосподарства
 * викидають 79 кг їжі на людину на рік, це близько 60 % усіх харчових відходів,
 * і рівень майже однаковий у країнах з різним доходом.
 * Цифри пілоту — з прод-бази komora.im.pl.ua станом на 28.09.2026, лише акаунти
 * з входом через «Сільпо» (демо-акаунти не враховано).
 *
 *   npx tsx scripts/build-pitch-v7.ts
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const OUT = 'tutorial-out/slides'

interface Slide { file: string; kicker: string; lines: string[]; note?: string; big?: boolean }

const SLIDES: Slide[] = [
  { file: 'v7-problem', kicker: '1 · ПРОБЛЕМА', big: true, lines: [
    '79 кг їжі на людину за рік',
    'викидають домогосподарства.',
    'Це 60 % усіх харчових відходів.' ],
    note: 'ООН, Food Waste Index Report 2024. Рівень майже однаковий у країнах з різним доходом.' },
  { file: 'v7-hypothesis', kicker: 'ГІПОТЕЗА', big: true, lines: [
    'Їжа псується, бо ніхто',
    'не знає, що лежить удома',
    'і до коли.' ],
    note: 'Тому комора має наповнюватися сама — з чеків і фото.' },
  { file: 'v7-solution', kicker: '2 · ДЛЯ КОГО  ·  3 · РІШЕННЯ', lines: [
    'Родини, які готують удома й рахують бюджет',
    'Агент сам веде облік продуктів і термінів',
    'З чеків «Сільпо» і фото холодильника',
    'А вже з обліку — меню й кошик' ] },
  { file: 'v7-pilot', kicker: '8 · ПІЛОТ · ВЕРЕСЕНЬ 2026', lines: [
    '6 покупців увійшли через «Сільпо»',
    '3 ведуть комору',
    '64 продукти: 34 з касових чеків, 22 з фото, 8 вручну',
    '3 страви — повністю з того, що було вдома' ],
    note: 'Для висновків мало. Наступний етап міряє, скільки їжі списано вчасно, а скільки викинуто.' },
]

const html = (s: Slide) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#16161c}
  .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;
        padding:0 34px;box-sizing:border-box;
        font-family:-apple-system,'SF Pro Display',system-ui,sans-serif}
  .kicker{color:#ff7a00;font-size:13px;font-weight:800;letter-spacing:.14em;margin-bottom:18px}
  .line{color:#fff;font-size:24px;line-height:1.42;font-weight:600;margin-bottom:10px}
  .line.small{font-size:19.5px;font-weight:500;color:#e8e8ee}
  .note{color:#9a9aa5;font-size:15px;line-height:1.5;margin-top:22px}
  .rule{width:44px;height:3px;background:#ff7a00;border-radius:2px;margin-top:26px}
</style>
<div class="wrap">
  <div class="kicker">${s.kicker}</div>
  ${s.lines.map((l) => `<div class="line${s.big ? '' : ' small'}">${l}</div>`).join('')}
  ${s.note ? `<div class="note">${s.note}</div>` : ''}
  <div class="rule"></div>
</div>`

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  for (const s of SLIDES) {
    await page.setContent(html(s))
    await page.waitForTimeout(120)
    await page.screenshot({ path: `${OUT}/${s.file}.png` })
    console.log(`  ${s.file}.png`)
  }
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
