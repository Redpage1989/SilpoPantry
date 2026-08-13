'use client'

import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge, Button, Card, ModeBadge, SectionTitle } from '@/components/ui'
import { apiPost, ApiError } from '@/lib/client'

/** Схема форми збігається зі схемою API — одне джерело правди. */
const Schema = z.object({
  displayName: z.string().min(1, 'Вкажіть імʼя').max(40),
  members: z
    .array(
      z.object({
        name: z.string().min(1, 'Імʼя обовʼязкове').max(40),
        type: z.enum(['adult', 'child', 'teen', 'senior']),
        age: z.coerce.number().int().min(0).max(120).optional(),
        preferencesText: z.string().max(160).optional(),
      }),
    )
    .min(1, 'Додайте щонайменше одного члена родини'),
  restrictions: z.array(
    z.object({
      restrictionType: z.enum(['allergy', 'intolerance', 'diet', 'dislike', 'religious']),
      value: z.string().min(1, 'Вкажіть обмеження').max(40),
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      memberName: z.string().max(40).optional(),
    }),
  ),
  weeklyBudgetUah: z.coerce.number().int().min(0).max(100_000),
  mealsPerDay: z.coerce.number().int().min(1).max(6),
  maxCookMinutes: z.coerce.number().int().min(10).max(180),
})

type FormValues = z.infer<typeof Schema>

const TYPE_LABELS = { adult: 'Дорослий', teen: 'Підліток', child: 'Дитина', senior: 'Старший' } as const
const RESTRICTION_LABELS = {
  allergy: 'Алергія',
  intolerance: 'Непереносимість',
  diet: 'Дієта',
  dislike: 'Не любить',
  religious: 'Релігійне',
} as const

interface Prefill {
  displayName: string
  members: { name: string; type: 'adult' | 'child' | 'teen' | 'senior'; age?: number; preferences: string[] }[]
  restrictions: {
    restrictionType: 'allergy' | 'intolerance' | 'diet' | 'dislike' | 'religious'
    value: string
    severity: 'critical' | 'high' | 'medium' | 'low'
    memberName?: string
  }[]
  weeklyBudget: number | null
  mealsPerDay: number
  maxCookMinutes: number
}

export function OnboardingForm({ prefill, mode }: { prefill: Prefill; mode: 'live' | 'mock' }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      displayName: prefill.displayName,
      members:
        prefill.members.length > 0
          ? prefill.members.map((m) => ({
              name: m.name,
              type: m.type,
              age: m.age,
              preferencesText: m.preferences.join(', '),
            }))
          : [{ name: '', type: 'adult', age: undefined, preferencesText: '' }],
      restrictions: prefill.restrictions,
      weeklyBudgetUah: Math.round((prefill.weeklyBudget ?? 0) / 100),
      mealsPerDay: prefill.mealsPerDay,
      maxCookMinutes: prefill.maxCookMinutes,
    },
  })

  const members = useFieldArray({ control: form.control, name: 'members' })
  const restrictions = useFieldArray({ control: form.control, name: 'restrictions' })

  async function onSubmit(values: FormValues) {
    setError(null)
    try {
      await apiPost('/api/onboarding', {
        displayName: values.displayName,
        members: values.members.map((m) => ({
          name: m.name,
          type: m.type,
          age: m.age,
          preferences: (m.preferencesText ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 10),
        })),
        restrictions: values.restrictions,
        weeklyBudget: values.weeklyBudgetUah * 100,
        mealsPerDay: values.mealsPerDay,
        maxCookMinutes: values.maxCookMinutes,
      })
      router.push('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося зберегти')
    }
  }

  const hasAllergy = form.watch('restrictions').some((r) => r.restrictionType === 'allergy')

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="flex justify-end">
        <ModeBadge mode={mode} />
      </div>

      <Card>
        <label htmlFor="displayName" className="text-[12px] font-medium text-graphite-700">
          Як до вас звертатися
        </label>
        <input
          id="displayName"
          {...form.register('displayName')}
          className="mt-1 min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
        />
        {form.formState.errors.displayName && (
          <p className="mt-1 text-[12px] text-danger-700">{form.formState.errors.displayName.message}</p>
        )}
      </Card>

      <SectionTitle
        action={
          <button
            type="button"
            onClick={() => members.append({ name: '', type: 'adult', age: undefined, preferencesText: '' })}
            className="text-[13px] font-medium text-accent-700"
          >
            + Додати
          </button>
        }
      >
        Члени родини
      </SectionTitle>

      {members.fields.map((field, index) => (
        <Card key={field.id}>
          <div className="flex gap-2">
            <input
              {...form.register(`members.${index}.name`)}
              placeholder="Імʼя"
              aria-label="Імʼя члена родини"
              className="min-h-[46px] flex-1 rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
            />
            <input
              {...form.register(`members.${index}.age`)}
              inputMode="numeric"
              placeholder="Вік"
              aria-label="Вік"
              className="min-h-[46px] w-20 rounded-2xl bg-cream-100 px-3 text-center text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
            />
          </div>

          <Controller
            control={form.control}
            name={`members.${index}.type`}
            render={({ field: f }) => (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => f.onChange(t)}
                    className={`min-h-[36px] rounded-full px-3.5 text-[13px] font-medium ${
                      f.value === t ? 'bg-accent-700 text-white' : 'bg-cream-200 text-graphite-700'
                    }`}
                  >
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            )}
          />

          <input
            {...form.register(`members.${index}.preferencesText`)}
            placeholder="Улюблені продукти через кому"
            aria-label="Уподобання"
            className="mt-2 min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[14px] outline-none focus:ring-2 focus:ring-accent-700"
          />

          {members.fields.length > 1 && (
            <button
              type="button"
              onClick={() => members.remove(index)}
              className="mt-2 text-[13px] font-medium text-danger-700"
            >
              Видалити
            </button>
          )}
          {form.formState.errors.members?.[index]?.name && (
            <p className="mt-1 text-[12px] text-danger-700">
              {form.formState.errors.members[index]?.name?.message}
            </p>
          )}
        </Card>
      ))}

      <SectionTitle
        action={
          <button
            type="button"
            onClick={() => restrictions.append({ restrictionType: 'allergy', value: '', severity: 'critical' })}
            className="text-[13px] font-medium text-accent-700"
          >
            + Додати
          </button>
        }
      >
        Обмеження, алергії, небажані продукти
      </SectionTitle>

      {restrictions.fields.length === 0 && (
        <Card>
          <p className="text-[13px] text-graphite-500">
            Обмежень немає. Якщо в родині є алергія — обовʼязково додайте її, страви з алергеном
            будуть повністю виключені з рекомендацій.
          </p>
        </Card>
      )}

      {restrictions.fields.map((field, index) => (
        <Card key={field.id}>
          <Controller
            control={form.control}
            name={`restrictions.${index}.restrictionType`}
            render={({ field: f }) => (
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(RESTRICTION_LABELS) as (keyof typeof RESTRICTION_LABELS)[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      f.onChange(t)
                      form.setValue(`restrictions.${index}.severity`, t === 'allergy' ? 'critical' : 'medium')
                    }}
                    className={`min-h-[34px] rounded-full px-3 text-[12px] font-medium ${
                      f.value === t ? 'bg-accent-700 text-white' : 'bg-cream-200 text-graphite-700'
                    }`}
                  >
                    {RESTRICTION_LABELS[t]}
                  </button>
                ))}
              </div>
            )}
          />
          <div className="mt-2 flex gap-2">
            <input
              {...form.register(`restrictions.${index}.value`)}
              placeholder="Наприклад, арахіс або гостре"
              aria-label="Обмеження"
              className="min-h-[46px] flex-1 rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
            />
            <input
              {...form.register(`restrictions.${index}.memberName`)}
              placeholder="Кого"
              aria-label="Кого стосується"
              className="min-h-[46px] w-24 rounded-2xl bg-cream-100 px-3 text-[14px] outline-none focus:ring-2 focus:ring-accent-700"
            />
          </div>
          <button
            type="button"
            onClick={() => restrictions.remove(index)}
            className="mt-2 text-[13px] font-medium text-danger-700"
          >
            Видалити
          </button>
        </Card>
      ))}

      {hasAllergy && (
        <Card className="bg-danger-50">
          <p className="text-[12px] leading-relaxed text-danger-700">
            ⚠️ Застосунок допомагає фільтрувати страви й товари, але не дає медичних гарантій.
            Завжди перевіряйте склад на упаковці.
          </p>
        </Card>
      )}

      <SectionTitle>Бюджет і ритм</SectionTitle>
      <Card className="space-y-3">
        <div>
          <label htmlFor="budget" className="text-[12px] font-medium text-graphite-700">
            Бюджет на тиждень, грн
          </label>
          <input
            id="budget"
            {...form.register('weeklyBudgetUah')}
            inputMode="numeric"
            className="mt-1 min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="meals" className="text-[12px] font-medium text-graphite-700">
              Прийомів їжі на день
            </label>
            <input
              id="meals"
              {...form.register('mealsPerDay')}
              inputMode="numeric"
              className="mt-1 min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="cooktime" className="text-[12px] font-medium text-graphite-700">
              Час на готування, хв
            </label>
            <input
              id="cooktime"
              {...form.register('maxCookMinutes')}
              inputMode="numeric"
              className="mt-1 min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
            />
          </div>
        </div>
      </Card>

      {error && <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">{error}</div>}

      <Button type="submit" full disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Зберігаю…' : 'Зберегти й продовжити'}
      </Button>

      <div className="flex justify-center">
        <Badge tone="neutral">Ці дані не залишають ваш сервер</Badge>
      </div>
    </form>
  )
}
