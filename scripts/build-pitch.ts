/**
 * Відрендерити слайди пітчу. Тривалість задає не цей скрипт, а озвучка:
 * її підганяє scripts/assemble-pitch.py.
 *
 * Вступ і фінал — текстові слайди. Метрики й дорожня карта свідомо не
 * озвучуються: числа й переліки читаються з екрана краще, ніж на слух,
 * і не витрачають кредитів синтезу.
 *
 * Слайди рендеряться браузером, а не drawtext: ffmpeg не вміє переносити
 * рядки й кернити кирилицю, а тут потрібна та сама типографіка, що й у
 * застосунку.
 *
 *   npx tsx scripts/build-pitch.ts
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const OUT = 'tutorial-out/slides'

interface Slide { file: string; kicker: string; lines: string[]; sec: number }

const SLIDES: Slide[] = [
  // ── вступ: пункти 1–3 з листа журі ──────────────────────────────────
  { file: 'in1', kicker: '1 · ПРОБЛЕМА', sec: 0, lines: [
    'Щовечора родина відкриває',
    'холодильник — і не знає,',
    'що приготувати.' ] },
  { file: 'in2', kicker: '2 · ДЛЯ КОГО', sec: 0, lines: [
    'Родини, які готують удома',
    'й рахують бюджет.' ] },
  { file: 'in3', kicker: '3 · РІШЕННЯ', sec: 0, lines: [
    'Агент не радить — він робить.',
    'Знає, що у вас удома,',
    'і збирає кошик у «Сільпо».' ] },
  // ── фінал: пункти 4, 5, 7, 8, 9 ─────────────────────────────────────
  { file: 'out1', kicker: '4 · ЩО АГЕНТ РОБИТЬ САМ', sec: 0, lines: [
    'Читає профіль, родину, алергії',
    'Звіряє рецепт із коморою',
    'Шукає товари в каталозі',
    'Рахує вигоду й формує кошик' ] },
  { file: 'out2', kicker: '5 · MCP «СІЛЬПО»', sec: 0, lines: [
    '12 інструментів на читання',
    '2 на запис — додати й прибрати',
    'Запис лише після підтвердження' ] },
  { file: 'out3', kicker: '7 · ЩО ЗМІНЮЄТЬСЯ', sec: 0, lines: [
    'Менше викинутої їжі',
    'Менше часу на планування',
    'Кошик збирає агент,',
    'а не втомлена людина ввечері' ] },
  { file: 'out4', kicker: '8 · МЕТРИКИ', sec: 0, lines: [
    '% страв із наявних продуктів',
    'Списано вчасно, а не викинуто',
    'Конверсія: порада → кошик',
    'Хто веде комору через місяць' ] },
  { file: 'out5', kicker: '9 · НАСТУПНИЙ КРОК', sec: 0, lines: [
    'Прямий конектор чеків',
    'Спільна комора на кілька людей',
    'Той самий сценарій усередині',
    'застосунку «Сільпо»' ] },
]

const html = (s: Slide) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#16161c}
  .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;
        padding:0 34px;box-sizing:border-box;
        font-family:-apple-system,'SF Pro Display',system-ui,sans-serif}
  .kicker{color:#ff7a00;font-size:13px;font-weight:800;letter-spacing:.14em;
          margin-bottom:18px}
  .line{color:#fff;font-size:24px;line-height:1.42;font-weight:600;
        margin-bottom:10px}
  .line.small{font-size:19.5px;font-weight:500;color:#e8e8ee}
  .rule{width:44px;height:3px;background:#ff7a00;border-radius:2px;margin-top:26px}
</style>
<div class="wrap">
  ${s.kicker ? `<div class="kicker">${s.kicker}</div>` : ''}
  ${s.lines.map((l) => `<div class="line${s.lines.length > 2 ? ' small' : ''}">${l}</div>`).join('')}
  <div class="rule"></div>
</div>`

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  })
  for (const s of SLIDES) {
    await page.setContent(html(s))
    await page.waitForTimeout(120)
    await page.screenshot({ path: `${OUT}/${s.file}.png` })
    console.log(`  ${s.file}.png`)
  }
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
