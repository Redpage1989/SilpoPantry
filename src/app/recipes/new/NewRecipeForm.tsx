'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Badge, Button, Card, SectionTitle } from '@/components/ui'
import { apiPost, ApiError } from '@/lib/client'
import { DECLARABLE_ALLERGENS } from '@/lib/domain/user-recipes'
import {
  DIFFICULTY_LABELS,
  MEAL_LABELS,
  TIP_EMOJI,
  TIP_LABELS,
  type Difficulty,
  type MealType,
  type TipKind,
} from '@/lib/domain/types'

type Unit = 'г' | 'кг' | 'мл' | 'л' | 'шт' | 'ст.л' | 'ч.л'
const UNITS: Unit[] = ['г', 'кг', 'мл', 'л', 'шт', 'ст.л', 'ч.л']
const TIP_KINDS: TipKind[] = ['technique', 'substitute', 'storage', 'safety', 'kids']

interface Result {
  slug: string
  compositionVerified: boolean
  unknownIngredients: string[]
  note: string
}

export function NewRecipeForm() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [emoji, setEmoji] = useState('🍽️')
  const [servings, setServings] = useState(2)
  const [cookingTime, setCookingTime] = useState(30)
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [mealType, setMealType] = useState<MealType>('dinner')
  const [cuisine, setCuisine] = useState('Українська')
  const [ingredients, setIngredients] = useState([
    { name: '', quantity: 100, unit: 'г' as Unit },
    { name: '', quantity: 1, unit: 'шт' as Unit },
  ])
  const [steps, setSteps] = useState([{ text: '' }])
  const [tips, setTips] = useState<{ kind: TipKind; text: string }[]>([])
  const [allergens, setAllergens] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const submit = useMutation({
    mutationFn: () =>
      apiPost<Result>('/api/user-recipes', {
        title,
        summary,
        servings,
        cookingTime,
        difficulty,
        cuisine,
        mealType,
        imageEmoji: emoji,
        ingredients: ingredients.filter((i) => i.name.trim().length > 1),
        steps: steps.filter((s) => s.text.trim().length > 2),
        tips: tips.filter((t) => t.text.trim().length > 4),
        declaredAllergens: allergens,
        authorConfirmed: confirmed,
      }),
    onSuccess: (res) => setResult(res),
  })

  if (result) {
    return (
      <Card className={result.compositionVerified ? 'bg-success-50' : 'bg-warn-50'}>
        <div className="mb-2 text-3xl" aria-hidden>
          {result.compositionVerified ? '✅' : 'ⓘ'}
        </div>
        <h2 className="text-[17px] font-semibold">Рецепт опубліковано</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-graphite-700">{result.note}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => router.push('/recipes/community')}>
            До спільноти
          </Button>
          <Button onClick={() => { setResult(null); setTitle(''); setSummary(''); setIngredients([{ name: '', quantity: 100, unit: 'г' }, { name: '', quantity: 1, unit: 'шт' }]); setSteps([{ text: '' }]); setTips([]); setAllergens([]); setConfirmed(false) }}>
            Додати ще
          </Button>
        </div>
      </Card>
    )
  }

  const canSubmit =
    title.trim().length >= 3 &&
    summary.trim().length >= 10 &&
    ingredients.filter((i) => i.name.trim().length > 1).length >= 2 &&
    steps.filter((s) => s.text.trim().length > 2).length >= 1 &&
    confirmed

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <Field label="Назва страви">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Бабусині голубці"
            className={inputClass}
          />
        </Field>
        <Field label="Короткий опис">
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Чим ця страва особлива"
            className={inputClass}
          />
        </Field>
        <div className="flex gap-2">
          <Field label="Емодзі">
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} className={`${inputClass} w-20 text-center text-xl`} />
          </Field>
          <Field label="Порцій">
            <input
              inputMode="numeric"
              value={String(servings)}
              onChange={(e) => setServings(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              className={`${inputClass} w-20 text-center`}
            />
          </Field>
          <Field label="Хвилин">
            <input
              inputMode="numeric"
              value={String(cookingTime)}
              onChange={(e) => setCookingTime(Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
              className={`${inputClass} w-24 text-center`}
            />
          </Field>
        </div>
        <Field label="Прийом їжі">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(MEAL_LABELS) as MealType[]).map((m) => (
              <Chip key={m} active={mealType === m} onClick={() => setMealType(m)}>{MEAL_LABELS[m]}</Chip>
            ))}
          </div>
        </Field>
        <Field label="Складність">
          <div className="flex gap-1.5">
            {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => (
              <Chip key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>{DIFFICULTY_LABELS[d]}</Chip>
            ))}
          </div>
        </Field>
        <Field label="Кухня">
          <input value={cuisine} onChange={(e) => setCuisine(e.target.value)} className={inputClass} />
        </Field>
      </Card>

      <SectionTitle
        action={
          <button onClick={() => setIngredients((v) => [...v, { name: '', quantity: 100, unit: 'г' }])} className="text-[13px] font-medium text-accent-700">
            + Додати
          </button>
        }
      >
        Інгредієнти
      </SectionTitle>
      <Card className="space-y-2">
        {ingredients.map((ing, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={ing.name}
              onChange={(e) => setIngredients((v) => v.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
              placeholder="Назва"
              aria-label={`Інгредієнт ${i + 1}`}
              className={`${inputClass} flex-1`}
            />
            <input
              inputMode="decimal"
              value={String(ing.quantity)}
              onChange={(e) => setIngredients((v) => v.map((x, k) => (k === i ? { ...x, quantity: Number(e.target.value.replace(',', '.')) || 0 } : x)))}
              aria-label="Кількість"
              className={`${inputClass} w-20 text-center`}
            />
            <select
              value={ing.unit}
              onChange={(e) => setIngredients((v) => v.map((x, k) => (k === i ? { ...x, unit: e.target.value as Unit } : x)))}
              aria-label="Одиниця"
              className={`${inputClass} w-24`}
            >
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        ))}
      </Card>

      <SectionTitle
        action={
          <button onClick={() => setSteps((v) => [...v, { text: '' }])} className="text-[13px] font-medium text-accent-700">
            + Крок
          </button>
        }
      >
        Приготування
      </SectionTitle>
      <Card className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-2">
            <span className="mt-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-100 text-[13px] font-semibold text-accent-700">
              {i + 1}
            </span>
            <textarea
              value={s.text}
              onChange={(e) => setSteps((v) => v.map((x, k) => (k === i ? { text: e.target.value } : x)))}
              placeholder="Що робити на цьому кроці"
              aria-label={`Крок ${i + 1}`}
              rows={2}
              className={`${inputClass} flex-1 py-2`}
            />
          </div>
        ))}
      </Card>

      <SectionTitle
        action={
          <button onClick={() => setTips((v) => [...v, { kind: 'technique', text: '' }])} className="text-[13px] font-medium text-accent-700">
            + Порада
          </button>
        }
      >
        Поради
      </SectionTitle>
      <Card className="space-y-3">
        <p className="text-[12px] leading-relaxed text-graphite-500">
          Найцінніше в рецепті — те, чого немає в кроках. Що піде не так у новачка,
          чим замінити дефіцитне, як зберегти залишки.
        </p>
        {tips.map((t, i) => (
          <div key={i} className="space-y-2 border-t border-cream-200 pt-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap gap-1.5">
              {TIP_KINDS.map((k) => (
                <Chip key={k} active={t.kind === k} onClick={() => setTips((v) => v.map((x, idx) => (idx === i ? { ...x, kind: k } : x)))}>
                  {TIP_EMOJI[k]} {TIP_LABELS[k]}
                </Chip>
              ))}
            </div>
            <textarea
              value={t.text}
              onChange={(e) => setTips((v) => v.map((x, idx) => (idx === i ? { ...x, text: e.target.value } : x)))}
              placeholder="Наприклад: суху квасолю солять наприкінці, інакше не розвариться"
              rows={2}
              aria-label={`Порада ${i + 1}`}
              className={`${inputClass} w-full py-2`}
            />
          </div>
        ))}
      </Card>

      <SectionTitle>Алергени</SectionTitle>
      <Card>
        <p className="mb-3 text-[12px] leading-relaxed text-graphite-500">
          Позначте все, що є у складі. <strong>Це головне джерело правди для фільтра</strong>:
          застосунок не вгадує алергени з назв інгредієнтів, бо «арахісова паста» й
          «кокосове молоко» розпізнаються неправильно. Від вашої відмітки залежить,
          чи побачить цей рецепт родина з алергією.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {DECLARABLE_ALLERGENS.map((a) => (
            <Chip
              key={a}
              active={allergens.includes(a)}
              onClick={() => setAllergens((v) => (v.includes(a) ? v.filter((x) => x !== a) : [...v, a]))}
            >
              {a}
            </Chip>
          ))}
        </div>
        {allergens.length === 0 && (
          <p className="mt-3 text-[12px] text-graphite-300">Нічого не позначено — жодного з перелічених алергенів у складі немає.</p>
        )}
      </Card>

      <Card>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent-500)]"
          />
          <span className="text-[13px] leading-snug text-graphite-700">
            Підтверджую, що склад вказано чесно, і розумію: інші родини покладатимуться
            на ці дані під час вибору страви.
          </span>
        </label>
      </Card>

      {submit.isError && (
        <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">
          {submit.error instanceof ApiError ? submit.error.message : 'Не вдалося опублікувати'}
        </div>
      )}

      <Button full onClick={() => submit.mutate()} disabled={!canSubmit || submit.isPending}>
        {submit.isPending ? 'Публікую…' : 'Опублікувати рецепт'}
      </Button>
      {!canSubmit && (
        <p className="text-center text-[11px] text-graphite-300">
          Потрібні назва, опис, два інгредієнти, один крок і підтвердження складу.
        </p>
      )}
      <div className="flex justify-center pb-2">
        <Badge tone="neutral">Рецепт побачать інші користувачі</Badge>
      </div>
    </div>
  )
}

const inputClass =
  'min-h-[46px] rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-graphite-700">{label}</div>
      {children}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[36px] rounded-full px-3.5 text-[13px] font-medium transition-colors ${
        active ? 'bg-accent-700 text-white' : 'bg-cream-200 text-graphite-700'
      }`}
    >
      {children}
    </button>
  )
}
