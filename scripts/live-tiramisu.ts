/**
 * Прогін сценарію «Хочу тірамісу» на ЖИВОМУ MCP тим самим кодом, який
 * викликає екран /dish. Кошик НЕ змінюється: створюється лише чернетка
 * пропозиції, як і в UI до натискання «Підтвердити».
 */
import { runDishPlan } from '../src/lib/agent/orchestrator'
import { formatUah } from '../src/lib/domain/scoring'
import { formatQuantity } from '../src/lib/domain/units'

async function main() {
  const run = await runDishPlan('silpo-live-user', { query: 'тірамісу', servings: 6 })
  const d = run.data

  console.log(`\nрежим: ${run.mode.toUpperCase()} · ${run.liveMcpCalls} live MCP · ${run.durationMs} мс · кроків: ${run.plan.length}`)
  console.log(`страва: ${d.recipe.title} — ${d.recipe.cookingTime} хв, ${d.servings} порцій`)

  console.log('\n── ЩО ТРЕБА ДОКУПИТИ ──')
  for (const c of d.comparisons) {
    console.log(`\n${c.ingredient.name} — не вистачає ${formatQuantity(c.ingredient.missing, c.ingredient.unit)}`)
    for (const t of c.tiers) {
      const p = t.product
      const perKg = p.weighted ? ` · ${formatUah((t.lineTotal / t.quantity / p.packSize) * 1000)}/кг` : ''
      const size = p.unit === 'уп' ? 'упаковка' : `${p.packSize} ${p.unit}`
      console.log(`   ${t.tier.padEnd(8)} ${p.name.slice(0, 40).padEnd(40)} ${t.quantity} × ${size} = ${formatUah(t.lineTotal)}${perKg}`)
    }
  }

  console.log('\n── РАЗОМ ЗА РІВНЯМИ ──')
  for (const [tier, total] of Object.entries(d.totalsByTier)) {
    console.log(`   ${tier.padEnd(9)} ${formatUah(total as number)}`)
  }

  const cv = d.cookVsReady.comparison
  console.log('\n── ГОТУВАТИ ЧИ КУПИТИ ──')
  console.log(`   вдома:  ${formatUah(cv.cook.totalCost)} · ${formatUah(cv.cook.costPerServing)}/порція · ${cv.cook.minutes} хв`)
  if (cv.ready) {
    console.log(`   готове: ${cv.ready.product.name.slice(0, 45)} — ${formatUah(cv.ready.totalCost)} · ${formatUah(cv.ready.costPerServing)}/порція`)
  } else {
    console.log('   готове: аналога в каталозі не знайдено')
  }
  console.log(`   висновок: ${cv.explanation}`)

  console.log(`\nчернетка пропозиції: ${d.proposal ? `${formatUah(d.proposal.total)} (кошик НЕ змінено)` : 'не створена'}`)
}
main()
