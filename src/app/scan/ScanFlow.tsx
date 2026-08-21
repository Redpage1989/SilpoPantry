'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Card, InfoNote, SectionTitle } from '@/components/ui'
import { apiUpload, apiPost, ApiError } from '@/lib/client'
import { BarcodeScanner } from '@/components/BarcodeScanner'

import type { PantryUnit } from '@/lib/domain/types'

type Hint = 'fridge' | 'shelf' | 'cupboard' | 'package'

interface RecognizedRow {
  originalName: string
  normalizedName: string
  category: string
  storageLocation: string
  quantity: number
  unit: PantryUnit
  expiryDate: string | null
  confidence: number
  needsConfirmation: boolean
  brand: string | null
}

interface ScanResponse {
  jobId: string
  engine: 'claude' | 'demo'
  note: string
  items: RecognizedRow[]
}

const HINTS: { value: Hint; label: string; emoji: string }[] = [
  { value: 'fridge', label: 'Холодильник', emoji: '🧊' },
  { value: 'shelf', label: 'Полиця', emoji: '🗄️' },
  { value: 'cupboard', label: 'Кухонна шафа', emoji: '🚪' },
  { value: 'package', label: 'Упаковка', emoji: '🏷️' },
]

/**
 * Двофазний потік: фото → розпізнавання → ОБОВʼЯЗКОВЕ підтвердження.
 * Другий крок не можна пропустити: кнопка збереження живе лише на ньому.
 */
export function ScanFlow() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const [files, setFiles] = useState<File[]>([])
  const [hint, setHint] = useState<Hint>('fridge')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [rows, setRows] = useState<RecognizedRow[]>([])
  const [saved, setSaved] = useState<{ created: number } | null>(null)

  function addFiles(list: FileList | null) {
    if (!list) return
    const next = [...files, ...Array.from(list)].slice(0, 5)
    setFiles(next)
    setError(null)
  }

  async function recognize() {
    if (files.length === 0) {
      setError('Додайте щонайменше одне фото')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      for (const f of files) {
        form.append('photos', f)
        form.append('hints', hint)
      }
      const res = await apiUpload<ScanResponse>('/api/scan', form)
      setResult(res)
      setRows(res.items)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося розпізнати фото')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const res = await apiPost<{ created: number }>('/api/pantry', {
        // сам факт натискання цієї кнопки і є підтвердженням користувача
        confirmationToken: `scan-confirm-${Date.now()}`,
        items: rows.map((r) => ({
          originalName: r.originalName,
          category: r.category,
          quantity: r.quantity,
          unit: r.unit,
          expiryDate: r.expiryDate,
          storageLocation: r.storageLocation,
          source: 'photo',
          confidence: r.confidence,
        })),
        removeIds: [],
      })
      setSaved(res)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося зберегти')
    } finally {
      setBusy(false)
    }
  }

  if (saved) {
    return (
      <Card className="text-center">
        <div className="mb-2 text-4xl" aria-hidden>
          ✅
        </div>
        <h2 className="text-[17px] font-semibold">Додано до комори: {saved.created}</h2>
        <p className="mt-1 text-[13px] text-graphite-500">
          Тепер агент враховує ці продукти під час підбору страв.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => { setSaved(null); setResult(null); setRows([]); setFiles([]) }}>
            Сканувати ще
          </Button>
          <Button onClick={() => router.push('/recipes')}>Що приготувати?</Button>
        </div>
      </Card>
    )
  }

  // ── Крок 2: підтвердження ──────────────────────────────────────────
  if (result) {
    return (
      <div className="space-y-3">
        <Card className="bg-warn-50">
          <div className="flex items-start gap-2">
            <span aria-hidden>⚠️</span>
            <div className="text-[13px] leading-relaxed text-[#8a6200]">
              <strong>Розпізнавання не є точним.</strong> Фото не показує вагу, вміст закритої
              упаковки та термін придатності. Перевірте й виправте кожну позицію.
            </div>
          </div>
        </Card>

        <InfoNote>
          {result.engine === 'claude' ? '🤖 ' : '◐ '}
          {result.note}
        </InfoNote>

        <SectionTitle
          action={
            <button
              onClick={() =>
                setRows((r) => [
                  ...r,
                  {
                    originalName: '',
                    normalizedName: '',
                    category: 'Інше',
                    storageLocation: 'other',
                    quantity: 1,
                    unit: 'шт',
                    expiryDate: null,
                    confidence: 1,
                    needsConfirmation: false,
                    brand: null,
                  },
                ])
              }
              className="text-[13px] font-medium text-accent-700"
            >
              + Додати пропущений
            </button>
          }
        >
          Підтвердіть розпізнане ({rows.length})
        </SectionTitle>

        {rows.map((row, index) => (
          <Card key={index}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <Badge tone={row.confidence >= 0.85 ? 'success' : row.confidence >= 0.6 ? 'warn' : 'danger'}>
                впевненість {Math.round(row.confidence * 100)}%
              </Badge>
              <button
                onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
                className="rounded-xl px-3 py-1.5 text-[13px] font-medium text-danger-700 active:bg-danger-50"
                aria-label={`Видалити ${row.originalName || 'позицію'}`}
              >
                Видалити
              </button>
            </div>

            <input
              value={row.originalName}
              onChange={(e) => updateRow(setRows, index, { originalName: e.target.value })}
              placeholder="Назва продукту"
              aria-label="Назва продукту"
              className="min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[15px] font-medium outline-none focus:ring-2 focus:ring-accent-700"
            />

            <div className="mt-2 flex gap-2">
              <input
                inputMode="decimal"
                value={String(row.quantity)}
                onChange={(e) => updateRow(setRows, index, { quantity: Number(e.target.value.replace(',', '.')) || 0 })}
                aria-label="Кількість"
                className="min-h-[46px] flex-1 rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
              />
              <select
                value={row.unit}
                onChange={(e) => updateRow(setRows, index, { unit: e.target.value as PantryUnit })}
                aria-label="Одиниця виміру"
                className="min-h-[46px] w-24 rounded-2xl bg-cream-100 px-3 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
              >
                {(['шт', 'г', 'кг', 'мл', 'л'] as const).map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2">
              <label className="text-[12px] text-graphite-500">Термін придатності</label>
              <input
                type="date"
                value={row.expiryDate ? row.expiryDate.slice(0, 10) : ''}
                onChange={(e) =>
                  updateRow(setRows, index, {
                    expiryDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
                className="mt-1 min-h-[46px] w-full rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
              />
            </div>
          </Card>
        ))}

        {error && <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">{error}</div>}

        <div className="sticky bottom-[84px] space-y-2 pt-1">
          <Button full onClick={confirm} disabled={busy || rows.length === 0}>
            {busy ? 'Зберігаю…' : `Підтвердити та зберегти (${rows.length})`}
          </Button>
          <Button full variant="ghost" onClick={() => { setResult(null); setRows([]) }}>
            Скасувати
          </Button>
        </div>
      </div>
    )
  }

  // ── Крок 1: фото ───────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div>
        <SectionTitle>Що ви фотографуєте?</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {HINTS.map((h) => (
            <button
              key={h.value}
              onClick={() => setHint(h.value)}
              className={`flex min-h-[52px] items-center gap-2 rounded-2xl px-4 text-[14px] font-medium transition-colors ${
                hint === h.value ? 'bg-accent-500 text-graphite-900' : 'bg-white text-graphite-700'
              }`}
            >
              <span aria-hidden>{h.emoji}</span>
              {h.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button onClick={() => cameraRef.current?.click()}>📷 Камера</Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          🖼️ З галереї
        </Button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        data-testid="scan-file-input"
        onChange={(e) => addFiles(e.target.files)}
      />

      {files.length > 0 && (
        <Card>
          <div className="mb-2 text-[13px] font-medium">Фото до аналізу: {files.length} / 5</div>
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-[13px] text-graphite-700">
                <span className="truncate">{f.name}</span>
                <button
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="shrink-0 text-[12px] font-medium text-danger-700"
                >
                  прибрати
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {error && <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">{error}</div>}

      <Button full onClick={recognize} disabled={busy || files.length === 0}>
        {busy ? 'Аналізую фото…' : 'Розпізнати продукти'}
      </Button>

      <BarcodeScanner
        onFound={(item) => {
          // Товар зі штрихкоду має точні назву й вагу з каталогу, тому
          // потрапляє одразу на екран підтвердження з повною впевненістю.
          setRows((prev) => [
            ...prev,
            {
              originalName: item.originalName,
              normalizedName: item.normalizedName,
              category: item.category,
              storageLocation: item.storageLocation,
              quantity: item.quantity,
              unit: item.unit,
              expiryDate: null,
              confidence: item.confidence,
              needsConfirmation: false,
              brand: null,
            },
          ])
          setResult((prev) =>
            prev ?? {
              jobId: 'barcode',
              engine: 'demo',
              note: 'Дані взято з каталогу «Сільпо» за штрихкодом — назва й вага точні',
              items: [],
            },
          )
        }}
      />
    </div>
  )
}

function updateRow(
  setRows: React.Dispatch<React.SetStateAction<RecognizedRow[]>>,
  index: number,
  patch: Partial<RecognizedRow>,
) {
  setRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
}
