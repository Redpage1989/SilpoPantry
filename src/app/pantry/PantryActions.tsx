'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, InfoNote } from '@/components/ui'
import { apiPut, apiPost, ApiError } from '@/lib/client'

interface ImportResult {
  imported: number
  /** позицій, до яких додали куплене поверх наявного */
  toppedUp: number
  skipped: number
  /** скільки чеків опрацьовано цього разу; 0 — усі вже враховані */
  newReceipts: number
  mode: 'live' | 'mock'
  modeReason: string
}

/** Дії над коморою: імпорт із чеків і ручне додавання товару. */
export function PantryActions() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)

  async function importReceipts() {
    setBusy(true)
    setError(null)
    try {
      const res = await apiPut<ImportResult>('/api/pantry')
      setResult(res)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося імпортувати чеки')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={importReceipts} disabled={busy}>
          {busy ? 'Імпортую…' : '🧾 Імпорт із чеків'}
        </Button>
        <Button variant="secondary" onClick={() => setShowManual((v) => !v)}>
          ✏️ Додати вручну
        </Button>
      </div>

      {result && (
        <InfoNote>
          {result.newReceipts === 0 ? (
            <>Нових чеків немає — усі покупки з історії вже враховані в коморі.</>
          ) : (
            <>
              Опрацьовано <strong>{result.newReceipts}</strong>{' '}
              {result.newReceipts === 1 ? 'чек' : result.newReceipts < 5 ? 'чеки' : 'чеків'}: додано{' '}
              <strong>{result.imported}</strong> позицій, поповнено <strong>{result.toppedUp}</strong>,
              пропущено <strong>{result.skipped}</strong> (протерміноване, непродовольче або вже спожите).
            </>
          )}
          {result.mode === 'mock' && ' Дані демонстраційні.'}
        </InfoNote>
      )}

      {error && (
        <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">{error}</div>
      )}

      {showManual && <ManualAddForm onDone={() => { setShowManual(false); router.refresh() }} />}
    </div>
  )
}

function ManualAddForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState<'г' | 'кг' | 'мл' | 'л' | 'шт'>('шт')
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/pantry', {
        confirmationToken: `manual-${Date.now()}`,
        items: [
          {
            originalName: name.trim(),
            quantity: Number(quantity.replace(',', '.')) || 1,
            unit,
            expiryDate: expiry ? new Date(expiry).toISOString() : null,
            source: 'manual',
            confidence: 1,
            category: 'Інше',
            storageLocation: 'other',
          },
        ],
        removeIds: [],
      })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося зберегти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="m-name" className="text-[12px] font-medium text-graphite-700">
            Назва продукту
          </label>
          <input
            id="m-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Наприклад, Сир твердий"
            className="mt-1 min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="m-qty" className="text-[12px] font-medium text-graphite-700">
              Кількість
            </label>
            <input
              id="m-qty"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="mt-1 min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
            />
          </div>
          <div className="w-24">
            <label htmlFor="m-unit" className="text-[12px] font-medium text-graphite-700">
              Одиниця
            </label>
            <select
              id="m-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value as typeof unit)}
              className="mt-1 min-h-[46px] w-full rounded-2xl bg-cream-100 px-3 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
            >
              {(['шт', 'г', 'кг', 'мл', 'л'] as const).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="m-exp" className="text-[12px] font-medium text-graphite-700">
            Термін придатності (необовʼязково)
          </label>
          <input
            id="m-exp"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="mt-1 min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
          />
        </div>
        {error && <div className="text-[13px] text-danger-700">{error}</div>}
        <Button type="submit" full disabled={busy}>
          {busy ? 'Зберігаю…' : 'Додати до комори'}
        </Button>
      </form>
    </Card>
  )
}
